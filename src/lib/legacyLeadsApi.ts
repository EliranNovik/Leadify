import { supabase } from './supabase';
import { generateSearchVariants } from './transliteration';

// -----------------------------------------------------
// Types
// -----------------------------------------------------

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
  isContact?: boolean;
  contactName?: string;
  isMainContact?: boolean;
}

// -----------------------------------------------------
// Utilities
// -----------------------------------------------------

const normalizeQuery = (q: string) => q.trim().toLowerCase();
const getDigits = (q: string) => q.replace(/\D/g, '');
const looksLikeEmail = (q: string) => q.includes('@');
const stripLeadPrefix = (q: string) => q.replace(/^[LC]/i, '');

// Build phone search OR condition - match by last 6-8 digits
// Phone numbers are stored WITH country code (could be any country code), 
// sometimes with "050" after it, sometimes just "50"
// Examples: "972507825939", "1507825939", "9720507825939", etc.
// User might search: "0507825939" or "507825939"
const buildPhoneSearchOrCondition = (digits: string): string => {
  if (!digits || digits.length < 4) {
    return ''; // Need at least 4 digits for meaningful search
  }
  
  let searchDigits = digits;
  const hadLeadingZero = searchDigits.startsWith('0');
  const normalizedDigits = hadLeadingZero ? searchDigits.slice(1) : searchDigits;
  
  const patterns: string[] = [];
  const minLength = 4; // Minimum 4 digits for meaningful matches
  
  // Strategy: Generate patterns that match numbers stored as:
  // - "XXX507825939" (country code + number without leading zero)
  // - "XXX0507825939" (country code + number with leading zero)
  // - "0507825939" (stored without country code)
  
  // Pattern 1: Last digits of normalized (without leading zero) - MOST RELIABLE
  // These match the end of numbers stored as "XXX507825939"
  // Generate last 8, 7, 6, 5, 4 digits
  for (let len = Math.min(normalizedDigits.length, 8); len >= minLength; len--) {
    patterns.push(normalizedDigits.slice(-len));
  }
  
  // Pattern 2: Full normalized number (matches "XXX507825939" after country code)
  if (normalizedDigits.length >= minLength) {
    patterns.push(normalizedDigits);
  }
  
  // Pattern 3: If user searched with leading zero, also search for patterns WITH zero
  if (hadLeadingZero && searchDigits.length >= minLength) {
    // Full pattern with zero (matches "XXX0507825939" after country code, or stored as-is)
    patterns.push(searchDigits);
    
    // Last digits with zero (for numbers like "XXX0507825939")
    // Generate patterns from the full search digits
    for (let len = Math.min(searchDigits.length, 10); len >= minLength; len--) {
      patterns.push(searchDigits.slice(-len));
    }
    
    // Also generate patterns starting from position 1 (after the zero)
    // This helps match "XXX507825939" when searching "0507825939"
    if (normalizedDigits.length >= minLength) {
      for (let len = Math.min(normalizedDigits.length, 8); len >= minLength; len--) {
        patterns.push(normalizedDigits.slice(-len));
      }
    }
  }
  
  // Pattern 4: If user searched WITHOUT leading zero, also try with zero prefix
  if (!hadLeadingZero && searchDigits.length >= minLength) {
    const withZeroPrefix = '0' + searchDigits;
    // Full pattern with zero prefix (matches "XXX0507825939" after country code)
    patterns.push(withZeroPrefix);
    
    // Last digits with zero prefix
    for (let len = Math.min(withZeroPrefix.length, 10); len >= minLength + 1; len--) {
      patterns.push(withZeroPrefix.slice(-len));
    }
    
    // Full normalized (matches "XXX507825939" after country code)
    patterns.push(searchDigits);
  }
  
  // Pattern 5: Full search query as-is (in case stored without country code)
  if (searchDigits.length >= minLength) {
    patterns.push(searchDigits);
  }
  
  // Remove duplicates and filter out patterns that are too short
  const uniquePatterns = Array.from(new Set(patterns.filter(p => p && p.length >= minLength)));
  
  if (uniquePatterns.length === 0) {
    return '';
  }
  
  // Build OR condition: search for all patterns in both phone and mobile columns
  // Using contains search (%pattern%) to find the digits anywhere in the number
  const conditions = uniquePatterns.flatMap(pattern => [
    `phone.ilike.%${pattern}%`,
    `mobile.ilike.%${pattern}%`
  ]);
  
  return conditions.join(',');
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
    ),
  ]) as Promise<T>;
};

// -----------------------------------------------------
// Fetch all leads
// -----------------------------------------------------

export async function fetchAllLeads(): Promise<CombinedLead[]> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error || !data) {
      console.error('Error fetching all leads', error);
      return [];
    }

    return data.map((lead: any) => ({
      id: lead.id,
      lead_number: lead.lead_number || '',
      manual_id: lead.lead_number || null,
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      mobile: lead.mobile || '',
      topic: lead.topic || '',
      stage: String(lead.stage ?? ''),
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
  } catch (err) {
    console.error('Error in fetchAllLeads', err);
    return [];
  }
}

// -----------------------------------------------------
// Fetch single lead by ID
// -----------------------------------------------------

export async function fetchLeadById(leadId: string): Promise<CombinedLead | null> {
  try {
    if (leadId.startsWith('legacy_')) {
      const numericId = leadId.replace('legacy_', '');

      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
        .eq('id', numericId)
        .single();

      if (error || !data) return null;

      const leadNumber = data.lead_number ? String(data.lead_number) : String(data.id);

      return {
        id: String(data.id),
        lead_number: leadNumber,
        manual_id: leadNumber,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        mobile: data.mobile || '',
        topic: data.topic || '',
        stage: String(data.stage ?? ''),
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
    }

      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .eq('id', leadId)
        .single();

    if (error || !data) return null;

      return {
        id: data.id,
        lead_number: data.lead_number || '',
      manual_id: data.lead_number || null,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        mobile: data.mobile || '',
        topic: data.topic || '',
      stage: String(data.stage ?? ''),
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
  } catch {
    return null;
  }
}

// -----------------------------------------------------
// New leads simple search - OPTIMIZED FOR SPEED
// -----------------------------------------------------

async function searchNewLeadsSimple(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 1) return []; // Allow 1 char for immediate feedback

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);
  const hasPrefix = /^[LC]/i.test(trimmed);
  // Check if it's a pure numeric query (all digits) - could be a lead number
  const isNumeric = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
  const isPureNumeric = /^\d+$/.test(trimmed) && trimmed.length === digits.length; // No formatting/spaces
  const isEmail = looksLikeEmail(trimmed);
  // Phone detection: 
  // - 4+ digits starting with 0: phone (e.g., "0507")
  // - 7+ digits: always phone (lead numbers are max 6 digits)
  // - 3-6 digits that are NOT pure numeric (has formatting/spaces): phone
  const startsWithZero = digits.startsWith('0') && digits.length >= 4;
  // Lead number: has prefix OR pure numeric query with 1-6 digits (but NOT if starts with 0 and 4+ digits)
  // Lead numbers are always max 6 digits
  const isLeadNumber = hasPrefix || (isNumeric && isPureNumeric && digits.length <= 6 && !startsWithZero);
  // Phone: starts with 0 OR 7+ digits OR has formatting (not pure numeric) OR 3-6 digits that aren't lead numbers
  const isPhone = startsWithZero || digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !isNumeric && !hasPrefix && trimmed.length > digits.length);

  // Minimal columns for fastest query
  const selectFields = 'id, lead_number, name, email, phone, mobile, topic, stage, created_at';

  try {
    let queryBuilder = supabase.from('leads').select(selectFields);

    // Check if query contains "/" pattern (sub-lead search: e.g., "39854/2" or "L39854/2")
    const hasSubLeadPattern = trimmed.includes('/');
    let masterIdFromQuery: number | null = null;
    let suffixFromQuery: number | null = null;
    
    if (hasSubLeadPattern) {
      const parts = trimmed.split('/');
      if (parts.length === 2) {
        const masterPart = parts[0].replace(/^[LC]/i, ''); // Remove L or C prefix if present
        const suffixPart = parts[1];
        const masterNum = parseInt(masterPart, 10);
        const suffixNum = parseInt(suffixPart, 10);
        if (!isNaN(masterNum) && !isNaN(suffixNum)) {
          masterIdFromQuery = masterNum;
          suffixFromQuery = suffixNum;
        }
      }
    }

    // Search as lead number if detected (any length for new leads)
    if (isLeadNumber || hasSubLeadPattern) {
      // Search for lead_number - use ALL digits typed for precise matching
      // If user types "12345", find "12345", "L12345", "C12345", "123456", etc.
      // As user types more digits, search becomes more precise (no reload needed)
      const searchDigits = noPrefix; // Use all digits, not just first 4
      
      if (hasPrefix || hasSubLeadPattern) {
        // User typed with prefix (e.g., "L12345") or sub-lead pattern (e.g., "39854/2")
        // Match: "L12345", "C12345", "12345", "L123456", "C123456", "123456", etc.
        // For sub-leads: "L39854/2", "39854/2", "L39854/3", etc.
        queryBuilder = queryBuilder.or(`lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%,lead_number.ilike.${searchDigits}%`);
        
        // For sub-lead pattern, also search for master number to find all sub-leads
        if (hasSubLeadPattern && masterIdFromQuery !== null) {
          queryBuilder = queryBuilder.or(`lead_number.ilike.%${masterIdFromQuery}/%,lead_number.ilike.L%${masterIdFromQuery}/%,lead_number.ilike.C%${masterIdFromQuery}/%`);
        }
      } else {
        // User typed without prefix (e.g., "12345") - search for numbers starting with "12345"
        // Match: "12345", "L12345", "C12345", "123456", "L123456", "C123456", etc.
        // For sub-leads: "39854/2", "L39854/2", "39854/3", etc.
        queryBuilder = queryBuilder.or(`lead_number.ilike.${searchDigits}%,lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%`);
        
        // For sub-lead pattern, also search for master number to find all sub-leads
        if (hasSubLeadPattern && masterIdFromQuery !== null) {
          queryBuilder = queryBuilder.or(`lead_number.ilike.%${masterIdFromQuery}/%,lead_number.ilike.L%${masterIdFromQuery}/%,lead_number.ilike.C%${masterIdFromQuery}/%`);
        }
      }
    } else if (isEmail) {
      queryBuilder = queryBuilder.ilike('email', `${lower}%`);
    } else if (isPhone) {
      const phoneCondition = buildPhoneSearchOrCondition(digits);
      // Debug logging (disabled by default)
      // console.log('[Phone Search] Query:', trimmed, 'Digits:', digits, 'isPhone:', isPhone, 'startsWithZero:', digits.startsWith('0'), 'Condition:', phoneCondition);
      if (phoneCondition) {
        queryBuilder = queryBuilder.or(phoneCondition);
      } else {
        console.warn('[Phone Search] Empty condition returned, skipping phone search');
        return []; // Return empty if no valid condition
      }
    } else {
      // Debug logging (disabled by default)
      // if (digits.length >= 3 && digits.length <= 6) {
      //   console.log('[Phone Search] NOT treated as phone:', {
      //     query: trimmed,
      //     digits,
      //     digitsLength: digits.length,
      //     isPhone,
      //     isLeadNumber,
      //     isEmail,
      //     isNumeric,
      //     hasPrefix
      //   });
      // }
      // Name - starts-with for speed, works with 1+ chars
      // Include multilingual variants for Hebrew/Arabic/English matching
      const nameVariants = generateSearchVariants(trimmed);
      if (nameVariants.length > 1) {
        // Multiple variants - use OR condition
        const nameConditions = nameVariants.map(v => `name.ilike.${v}%`).join(',');
        queryBuilder = queryBuilder.or(nameConditions);
      } else {
        // Single variant - use simple ilike
        queryBuilder = queryBuilder.ilike('name', `${lower}%`);
      }
    }

    const { data, error } = await queryBuilder.limit(limit);

    if (error || !data || data.length === 0) return [];

    // Fast mapping
    return data.map((lead: any) => ({
      id: lead.id,
      lead_number: lead.lead_number || '',
      manual_id: lead.lead_number || null,
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      mobile: lead.mobile || '',
      topic: lead.topic || '',
      stage: String(lead.stage ?? ''),
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
  } catch (err) {
    return [];
  }
}

// -----------------------------------------------------
// Legacy exact search - COMMENTED OUT FOR OPTIMIZATION
// -----------------------------------------------------

/*
async function searchLegacyLeadsExact(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);

  const isNumeric = /^\d+$/.test(noPrefix);
  const isEmail = looksLikeEmail(trimmed);
  // Phone: require at least 3 digits (consistent with other searches)
  // This makes the search more responsive when typing fast
  const isPhone = digits.length >= 3 && !isNumeric;

  let rows: any[] = [];

  try {
    if (isNumeric) {
      // Numeric search - try multiple approaches: ID, lead_number (numeric), lead_number (text with prefix)
      const num = parseInt(noPrefix, 10);
      if (!Number.isNaN(num)) {
        // Try exact matches - run in parallel for speed
        const queries = [
          // Exact ID match
          supabase
            .from('leads_lead')
            .select('*')
            .eq('id', num)
            .limit(limit),
          // Exact lead_number match (numeric)
          supabase
            .from('leads_lead')
            .select('*')
            .eq('lead_number', num)
            .limit(limit),
          // Exact lead_number match (text - in case stored with prefix like "L123")
          trimmed !== noPrefix
            ? supabase
                .from('leads_lead')
                .select('*')
                .eq('lead_number', trimmed)
                .limit(limit)
            : Promise.resolve({ data: [], error: null }),
        ];
        
        const results = await Promise.allSettled(queries);
        
        // Collect all results
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.data) {
            result.value.data.forEach((row: any) => {
              if (!rows.find((r: any) => r.id === row.id)) {
                rows.push(row);
              }
            });
          }
        });
      }
    } else if (isPhone) {
      // Phone search - search for phone/mobile numbers containing the digits in sequence
      // This works for any partial match: "050" finds "0501234567", "050-123-4567", etc.
      if (digits.length >= 3) {
        // Use dynamic timeout and limit based on digit count for better responsiveness
        const timeoutMs = digits.length >= 7 ? 2500 : digits.length >= 5 ? 2000 : 1500;
        const searchLimit = digits.length >= 7 ? 20 : digits.length >= 5 ? 10 : 5;
        
        const queryPromise = (async () => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('*')
            .or(buildPhoneSearchOrCondition(digits))  // Handles country codes
            .limit(searchLimit);
          return { data, error };
    })();

        const result = await withTimeout(
          queryPromise,
          timeoutMs,  // Dynamic timeout based on digit count
          'phone search timeout'
        ).catch(() => ({ data: null, error: null }));
        rows = (result as any)?.data || [];
        }
      } else if (isEmail) {
        // Email search - use lower() to leverage idx_leads_lead_email_lower index
        try {
          const { data, error } = await withTimeout(
            (async () => {
              return await supabase
                .from('leads_lead')
                .select('*')
                .ilike('email', `${lower}%`)  // Starts-with search using index
                .limit(10);  // Reduced limit for faster queries
            })(),
            3000,  // Increased to 3 seconds timeout for email search
            'legacy email search timeout'
          );
          
          if (error) {
            console.warn('[searchLegacyLeadsExact] Email search error:', error);
            rows = [];
          } else {
            rows = data || [];
          }
        } catch (err) {
          console.warn('[searchLegacyLeadsExact] Email search failed:', err);
          rows = [];
        }
      } else {
        // Name search DISABLED for legacy leads - consistently times out
        // Legacy leads by name are found through contacts search instead
        // Contacts search uses leads_contact table which has better indexes
        // and finds legacy leads via lead_leadcontact junction table
        // This prevents timeouts and provides better user experience
        rows = [];
    }
  } catch (err) {
    // Silently fail - return empty results
    console.warn('[searchLegacyLeadsExact] Search failed:', err);
    return [];
  }

  return rows.map((l: any) => {
    const leadNumber = l.lead_number ? String(l.lead_number) : String(l.id);

    return {
      id: String(l.id),
      lead_number: leadNumber,
      manual_id: leadNumber,
      name: l.name || '',
      email: l.email || '',
      phone: l.phone || '',
      mobile: l.mobile || '',
      topic: l.topic || '',
      stage: String(l.stage ?? ''),
      source: '',
      created_at: l.cdate || '',
      updated_at: l.cdate || '',
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
  });
}
*/

// -----------------------------------------------------
// Contacts search - FOR NEW AND LEGACY LEADS
// -----------------------------------------------------

async function searchContactsSimple(query: string, limit = 30): Promise<CombinedLead[]> {
  console.log('[searchContactsSimple] FUNCTION CALLED:', {
    query,
    queryLength: query.length,
    trimmed: query.trim(),
    trimmedLength: query.trim().length
  });
  
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    console.log('[searchContactsSimple] EARLY RETURN - query too short:', {
      trimmed,
      length: trimmed.length,
      isEmpty: !trimmed
    });
    return [];
  }

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);
  const isEmail = looksLikeEmail(trimmed);
  // Check if it's a pure numeric query (all digits) - could be a lead number
  const isNumericQuery = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
  const isPureNumeric = /^\d+$/.test(trimmed) && trimmed.length === digits.length; // No formatting/spaces
  const hasPrefix = /^[LC]/i.test(trimmed);
  // Phone detection: 
  // - 4+ digits starting with 0: phone (e.g., "0507")
  // - 7+ digits: always phone (lead numbers are max 6 digits)
  // - 3-6 digits that are NOT pure numeric (has formatting/spaces): phone
  const startsWithZero = digits.startsWith('0') && digits.length >= 4;
  // Lead number: has prefix OR pure numeric query with 1-6 digits (but NOT if starts with 0 and 4+ digits)
  // Lead numbers are always max 6 digits
  const isLeadNumber = hasPrefix || (isNumericQuery && isPureNumeric && digits.length <= 6 && !startsWithZero);
  // Phone: starts with 0 OR 7+ digits OR has formatting (not pure numeric) OR 3-6 digits that aren't lead numbers
  const isPhone = startsWithZero || digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !isNumericQuery && !hasPrefix);
  
  console.log('[searchContactsSimple] Query analysis:', {
    query: trimmed,
    digits,
    noPrefix,
    isNumericQuery,
    isPureNumeric,
    hasPrefix,
    startsWithZero,
    digitsLength: digits.length,
    isLeadNumber,
    isPhone,
    isEmail
  });

  try {
    let contacts: any[] = [];
    let rels: any[] = [];
    let foundLegacyLeadIds: number[] = []; // Declare outside block so it's accessible later
    let cachedLegacyLeadsMap = new Map<number, any>(); // Cache for legacy leads to avoid re-fetching

    // Check if query contains "/" pattern (sub-lead search: e.g., "39854/2")
    const hasSubLeadPattern = trimmed.includes('/');
    let masterIdFromQuery: number | null = null;
    let suffixFromQuery: number | null = null;
    
    if (hasSubLeadPattern) {
      const parts = trimmed.split('/');
      if (parts.length === 2) {
        const masterPart = parts[0].replace(/^[LC]/i, ''); // Remove L or C prefix if present
        const suffixPart = parts[1];
        const masterNum = parseInt(masterPart, 10);
        const suffixNum = parseInt(suffixPart, 10);
        if (!isNaN(masterNum) && !isNaN(suffixNum)) {
          masterIdFromQuery = masterNum;
          suffixFromQuery = suffixNum;
        }
      }
    }

    // Step 1: If searching by lead number, find contacts via junction table
    if (isLeadNumber || hasSubLeadPattern) {
      // Use all digits typed (not just first 4) for precise matching
      const searchDigits = noPrefix;
      const hasPrefix = /^[LC]/i.test(trimmed);
      
      console.log('[searchContactsSimple] Lead number search:', {
        query: trimmed,
        searchDigits,
        hasPrefix,
        isLeadNumber,
        hasSubLeadPattern,
        masterIdFromQuery,
        suffixFromQuery,
        digitsLength: digits.length
      });
      
      // First, find new leads matching the lead number
      let leadQuery = supabase
        .from('leads')
        .select('id, lead_number')
        .limit(50);
      
      if (hasPrefix || hasSubLeadPattern) {
        leadQuery = leadQuery.or(`lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%,lead_number.ilike.${searchDigits}%`);
        // For sub-lead pattern, also search for master number to find all sub-leads
        if (hasSubLeadPattern && masterIdFromQuery !== null) {
          leadQuery = leadQuery.or(`lead_number.ilike.%${masterIdFromQuery}/%,lead_number.ilike.L%${masterIdFromQuery}/%,lead_number.ilike.C%${masterIdFromQuery}/%`);
        }
      } else {
        leadQuery = leadQuery.or(`lead_number.ilike.${searchDigits}%,lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%`);
        // For sub-lead pattern, also search for master number to find all sub-leads
        if (hasSubLeadPattern && masterIdFromQuery !== null) {
          leadQuery = leadQuery.or(`lead_number.ilike.%${masterIdFromQuery}/%,lead_number.ilike.L%${masterIdFromQuery}/%,lead_number.ilike.C%${masterIdFromQuery}/%`);
        }
      }
      
      const { data: matchingLeads } = await leadQuery;
      const newLeadIds = matchingLeads ? matchingLeads.map((l: any) => l.id) : [];
      
      console.log('[searchContactsSimple] New leads found:', newLeadIds.length);
      
      // Also search for legacy leads by ID (legacy leads use id as lead_number)
      // Support both exact match and prefix match for legacy lead IDs
      // For sub-lead patterns, search by master_id
      const num = hasSubLeadPattern && masterIdFromQuery !== null 
        ? masterIdFromQuery 
        : parseInt(noPrefix, 10);
      foundLegacyLeadIds = []; // Reset for this search
      
      if (!Number.isNaN(num)) {
        console.log('[searchContactsSimple] Searching legacy lead ID:', {
          num,
          noPrefix,
          parsed: num,
          isValid: !Number.isNaN(num)
        });
        
        // Prefix match: search for legacy leads where id (as text) starts with the search digits
        // This allows finding "192191" when searching "19", "192", "1921", etc.
        // Use a range query to efficiently find IDs that start with the search digits
        try {
          const searchStr = String(num);
          const minId = num;
          // Calculate max ID: for "19" (2 digits), we want up to 199999 (6 digits max)
          // For "192" (3 digits), we want up to 192999, etc.
          // Formula: num * 10^(6 - length) + 10^(6 - length) - 1
          const remainingDigits = Math.max(0, 6 - searchStr.length);
          const maxId = num * Math.pow(10, remainingDigits) + Math.pow(10, remainingDigits) - 1;
          
          console.log('[searchContactsSimple] Legacy lead ID range calculation:', { 
            searchStr, 
            minId, 
            maxId, 
            remainingDigits,
            calculation: `${num} * 10^${remainingDigits} + 10^${remainingDigits} - 1 = ${maxId}`
          });
          
          console.log('[searchContactsSimple] Querying leads_lead table:', {
            table: 'leads_lead',
            minId,
            maxId,
            limit: 200
          });
          
          // OPTIMIZATION: Fetch full lead data in one query instead of just IDs
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select('id, name, email, phone, mobile, topic, stage, cdate, master_id')
            .gte('id', minId)
            .lte('id', maxId)
            .limit(200); // Increased limit for prefix matches
          
          if (legacyLeadsError) {
            console.error('[searchContactsSimple] ERROR querying legacy leads:', {
              error: legacyLeadsError,
              message: legacyLeadsError.message,
              details: legacyLeadsError.details,
              hint: legacyLeadsError.hint,
              code: legacyLeadsError.code
            });
          } else {
            console.log('[searchContactsSimple] Legacy leads query result:', {
              count: legacyLeads?.length || 0,
              sampleIds: legacyLeads?.slice(0, 5).map((l: any) => l.id) || [],
              allIds: legacyLeads?.map((l: any) => l.id) || []
            });
            
            if (legacyLeads && legacyLeads.length > 0) {
              console.log('[searchContactsSimple] Filtering legacy leads by prefix:', {
                searchStr,
                totalFound: legacyLeads.length,
                beforeFilter: foundLegacyLeadIds.length
              });
              
              // OPTIMIZATION: Store full lead data, not just IDs
              const filteredLegacyLeads: any[] = [];
              
              // Filter to only include IDs that start with the search digits (as text)
              // OPTIMIZATION: Cache full lead data while filtering
              legacyLeads.forEach((lead: any) => {
                const leadIdStr = String(lead.id);
                const matches = leadIdStr.startsWith(searchStr);
                if (matches && !foundLegacyLeadIds.includes(lead.id)) {
                  foundLegacyLeadIds.push(lead.id);
                  cachedLegacyLeadsMap.set(lead.id, lead); // Cache full lead data
                  console.log('[searchContactsSimple] Added legacy lead ID:', {
                    id: lead.id,
                    idStr: leadIdStr,
                    searchStr,
                    matches
                  });
                } else if (!matches) {
                  console.log('[searchContactsSimple] Skipped legacy lead ID (doesn\'t match prefix):', {
                    id: lead.id,
                    idStr: leadIdStr,
                    searchStr,
                    matches
                  });
                }
              });
              
              console.log('[searchContactsSimple] Legacy lead IDs after filtering:', {
                count: foundLegacyLeadIds.length,
                ids: foundLegacyLeadIds
              });
            } else {
              console.warn('[searchContactsSimple] No legacy leads found in range:', {
                minId,
                maxId,
                searchStr,
                possibleReasons: [
                  'No leads exist in this ID range',
                  'Range calculation might be incorrect',
                  'Table might be empty or have different ID structure'
                ]
              });
            }
          }
        } catch (err) {
          // If query fails, log error but continue
          console.error('[searchContactsSimple] EXCEPTION in legacy lead ID search:', {
            error: err,
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
          });
        }
      } else {
        console.warn('[searchContactsSimple] Cannot parse as number:', {
          noPrefix,
          parsed: num,
          isNaN: Number.isNaN(num)
        });
      }
      
      // OPTIMIZATION: Parallelize junction table queries and contact fetching
      if (newLeadIds.length > 0 || foundLegacyLeadIds.length > 0) {
        console.log('[searchContactsSimple] Finding contacts for leads:', {
          newLeadIds: newLeadIds.length,
          foundLegacyLeadIds: foundLegacyLeadIds.length
        });
        
        // OPTIMIZATION: Run junction queries in parallel
        const junctionQueries = [];
        
        if (newLeadIds.length > 0) {
          junctionQueries.push(
            supabase
              .from('lead_leadcontact')
              .select('contact_id, newlead_id, lead_id, main')
              .in('newlead_id', newLeadIds)
              .limit(200)
          );
        }
        
        if (foundLegacyLeadIds.length > 0) {
          junctionQueries.push(
            supabase
              .from('lead_leadcontact')
              .select('contact_id, newlead_id, lead_id, main')
              .in('lead_id', foundLegacyLeadIds)
              .limit(200)
          );
        }
        
        // Execute all junction queries in parallel
        const junctionResults = await Promise.all(junctionQueries);
        
        // Collect all relationships
        junctionResults.forEach((result: any) => {
          if (result.data && !result.error) {
            rels.push(...result.data);
          } else if (result.error) {
            console.error('[searchContactsSimple] Junction query error:', result.error);
          }
        });
        
        // Get contact IDs from relationships
        const contactIds = Array.from(new Set(rels.map((r: any) => r.contact_id).filter(Boolean)));
        
        console.log('[searchContactsSimple] Contact IDs from relationships:', contactIds.length);
        
        // OPTIMIZATION: Fetch contacts in parallel with other operations if possible
        if (contactIds.length > 0) {
          const { data: contactsData, error: contactsError } = await supabase
            .from('leads_contact')
            .select('id, name, email, phone, mobile, newlead_id')
            .in('id', contactIds)
            .limit(100);
          
          if (contactsError) {
            console.error('[searchContactsSimple] Error fetching contacts:', contactsError);
          } else {
            contacts = contactsData || [];
          }
        }
      }
      
      console.log('[searchContactsSimple] Final contacts count:', contacts.length);
      
      // Don't return empty too early - if we found leads but no contacts, that's still a valid search result
      // The calling function will handle displaying the leads even without contacts
      // Only return empty if we didn't find any leads at all
      if (contacts.length === 0 && newLeadIds.length === 0 && foundLegacyLeadIds.length === 0) {
        console.log('[searchContactsSimple] No leads or contacts found, returning empty');
        return [];
      }
      
      // Store found legacy lead IDs for later use in building results
      if (foundLegacyLeadIds.length > 0) {
        // Add to rels so they're included in the results building below
        foundLegacyLeadIds.forEach((leadId: number) => {
          // Check if we already have a relationship for this lead
          const existingRel = rels.find((r: any) => r.lead_id === leadId);
          if (!existingRel) {
            // Add a placeholder relationship so the lead is included in results
            rels.push({ lead_id: leadId, contact_id: null, newlead_id: null, main: null });
          }
        });
      }
    }
    
    // Always search by phone if we have 3+ digits (but NOT if it's a lead number search)
    // Lead numbers should only search leads, not contacts
    if (digits.length >= 3 && !isEmail && !isLeadNumber) {
      let phoneContactQuery = supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile, newlead_id')
        .or(buildPhoneSearchOrCondition(digits))
        .limit(50);
      
      const { data: phoneContacts } = await phoneContactQuery;
      if (phoneContacts && phoneContacts.length > 0) {
        // Merge phone contacts with existing contacts
        const existingIds = new Set(contacts.map((c: any) => c.id));
        phoneContacts.forEach((pc: any) => {
          if (!existingIds.has(pc.id)) {
            contacts.push(pc);
          }
        });
      }
    }
    
    // If we didn't find contacts via lead number search, do normal search
    if (contacts.length === 0 && !isLeadNumber) {
      // Step 1: Search contacts by name, email, or phone (normal search)
      let contactQuery = supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile, newlead_id');

      if (isPhone && !isEmail) {
        contactQuery = contactQuery.or(buildPhoneSearchOrCondition(digits));
      } else if (isEmail) {
        contactQuery = contactQuery.ilike('email', `%${lower}%`); // Use contains for email too
      } else {
        // For name searches, use contains (ilike with % on both sides) to find all matches
        // Include multilingual variants for Hebrew/Arabic/English matching
        const nameVariants = generateSearchVariants(trimmed);
        if (nameVariants.length > 1) {
          // Multiple variants - use OR condition with contains search
          const nameConditions = nameVariants.map(v => `name.ilike.%${v}%`).join(',');
          contactQuery = contactQuery.or(nameConditions);
        } else {
          // Single variant - use simple ilike
          contactQuery = contactQuery.ilike('name', `%${lower}%`);
        }
      }

      const { data: contactsData, error } = await contactQuery.limit(50); // Reduced for speed
      contacts = contactsData || [];

      if (error || contacts.length === 0) return [];

      // Step 2: Always check junction table to find ALL contacts linked to leads (including legacy)
      // This ensures we find contacts even if they're only linked via junction table
      const contactIds = contacts.map((c: any) => c.id);
      
      // Always query junction table to find legacy leads (but only for found contacts - efficient)
      if (contactIds.length > 0) {
        const { data: relsData } = await supabase
          .from('lead_leadcontact')
          .select('contact_id, newlead_id, lead_id, main')
          .in('contact_id', contactIds)
          .limit(200); // Reasonable limit for performance

        rels = relsData || [];
      }
    }

    // OPTIMIZATION: Extract all IDs first, then fetch in parallel
    const directNewLeadIds = Array.from(
      new Set(contacts.map((c: any) => c.newlead_id).filter((id: any) => id != null))
    );
    
    const legacyLeadIdsFromRels = Array.from(
      new Set(rels.map((r: any) => r.lead_id).filter((id: any) => id != null))
    );
    
    const newLeadIdsFromJunction = Array.from(
      new Set(rels.map((r: any) => r.newlead_id).filter((id: any) => id != null))
    );
    
    // Combine legacy lead IDs
    let legacyLeadIds = [...legacyLeadIdsFromRels];
    if (isLeadNumber && foundLegacyLeadIds && foundLegacyLeadIds.length > 0) {
      foundLegacyLeadIds.forEach((id: number) => {
        if (!legacyLeadIds.includes(id)) {
          legacyLeadIds.push(id);
        }
      });
    }
    
    // OPTIMIZATION: Fetch new leads and legacy leads in parallel
    const fetchPromises: Promise<{ type: string; data: any[] }>[] = [];
    
    // Fetch direct new leads
    if (directNewLeadIds.length > 0) {
      fetchPromises.push(
        (async () => {
          const result = await supabase
            .from('leads')
            .select('id, lead_number, topic, stage, created_at')
            .in('id', directNewLeadIds)
            .limit(limit);
          return { type: 'direct', data: result.data || [] };
        })()
      );
    }
    
    // Fetch additional new leads from junction
    const additionalIds = newLeadIdsFromJunction.filter(id => !directNewLeadIds.includes(id));
    if (additionalIds.length > 0) {
      fetchPromises.push(
        (async () => {
          const result = await supabase
            .from('leads')
            .select('id, lead_number, topic, stage, created_at')
            .in('id', additionalIds)
            .limit(limit);
          return { type: 'junction', data: result.data || [] };
        })()
      );
    }
    
    // Fetch legacy leads (with cache check)
    let legacyLeadsFromCache: any[] = [];
    const missingLegacyIds: number[] = [];
    
    if (legacyLeadIds.length > 0) {
      // Check cache first
      legacyLeadIds.forEach((id: number) => {
        if (cachedLegacyLeadsMap.has(id)) {
          legacyLeadsFromCache.push(cachedLegacyLeadsMap.get(id));
        } else {
          missingLegacyIds.push(id);
        }
      });
      
      // Only fetch missing ones
      if (missingLegacyIds.length > 0) {
        fetchPromises.push(
          (async () => {
            const result = await supabase
              .from('leads_lead')
              .select('id, name, email, phone, mobile, topic, stage, cdate, master_id')
              .in('id', missingLegacyIds)
              .limit(limit);
            
            if (!result.error && result.data) {
              // Cache fetched leads
              result.data.forEach((lead: any) => {
                cachedLegacyLeadsMap.set(lead.id, lead);
              });
              return { type: 'legacy', data: result.data };
            }
            return { type: 'legacy', data: [] };
          })()
        );
      }
    }
    
    // Execute all fetches in parallel
    const fetchResults = await Promise.all(fetchPromises);
    
    // Combine results
    let newLeads: any[] = [];
    let legacyLeads: any[] = [...legacyLeadsFromCache]; // Start with cached ones
    
    fetchResults.forEach((result: any) => {
      if (result.type === 'direct' || result.type === 'junction') {
        newLeads.push(...result.data);
      } else if (result.type === 'legacy') {
        legacyLeads.push(...result.data);
      }
    });
    
    console.log('[searchContactsSimple] Fetched leads summary:', {
      newLeads: newLeads.length,
      legacyLeads: legacyLeads.length,
      fromCache: legacyLeadsFromCache.length,
      fromFetch: legacyLeads.length - legacyLeadsFromCache.length
    });

    if (newLeads.length === 0 && legacyLeads.length === 0) return [];

    // Step 6: Build maps (always build, not just for longer queries)
    const newLeadMap = new Map(newLeads.map((l: any) => [l.id, l]));
    const legacyLeadMap = new Map(legacyLeads.map((l: any) => [l.id, l]));
    const relMap = new Map<string, any[]>();
    if (rels) {
      rels.forEach((r: any) => {
        if (r.contact_id) {
          if (!relMap.has(r.contact_id)) relMap.set(r.contact_id, []);
          relMap.get(r.contact_id)!.push(r);
        }
      });
    }

    // Step 7: Build results (always include legacy leads, not just for longer queries)
    const results: CombinedLead[] = [];
    const seen = new Set<string>();

    contacts.forEach((c: any) => {
      // Direct new lead link (always fastest)
      if (c.newlead_id && newLeadMap.has(c.newlead_id)) {
        const key = `new:${c.newlead_id}:${c.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          const l = newLeadMap.get(c.newlead_id)!;
          results.push({
            id: l.id,
            lead_number: l.lead_number || '',
            manual_id: l.lead_number || null,
            name: c.name || '',
            email: c.email || '',
            phone: c.phone || '',
            mobile: c.mobile || '',
            topic: l.topic || '',
            stage: String(l.stage ?? ''),
            source: '',
            created_at: l.created_at || '',
            updated_at: l.created_at || '',
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
            isContact: true,
            contactName: c.name || '',
            isMainContact: false,
          });
        }
      }

      // Junction table links (ALWAYS check, including legacy leads)
      const contactRels = relMap.get(c.id) || [];
      contactRels.forEach((r: any) => {
        const isMain = r.main === true || r.main === 'true';
        
        // New leads via junction
        if (r.newlead_id && newLeadMap.has(r.newlead_id)) {
          const key = `new:${r.newlead_id}:${c.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            const l = newLeadMap.get(r.newlead_id)!;
            results.push({
              id: l.id,
              lead_number: l.lead_number || '',
              manual_id: l.lead_number || null,
              name: c.name || '',
              email: c.email || '',
              phone: c.phone || '',
              mobile: c.mobile || '',
              topic: l.topic || '',
              stage: String(l.stage ?? ''),
              source: '',
              created_at: l.created_at || '',
              updated_at: l.created_at || '',
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
              contactName: c.name || '',
              isMainContact: isMain,
            });
          }
        }
        
        // Legacy leads via junction (ALWAYS include, not just for longer queries)
        if (r.lead_id) {
          const key = `legacy:${r.lead_id}:${c.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            const legacyLead = legacyLeadMap.get(r.lead_id);
            results.push({
              id: String(r.lead_id),
              lead_number: legacyLead?.lead_number ? String(legacyLead.lead_number) : String(r.lead_id),
              manual_id: legacyLead?.lead_number ? String(legacyLead.lead_number) : String(r.lead_id),
              name: c.name || '',
              email: c.email || '',
              phone: c.phone || '',
              mobile: c.mobile || '',
              topic: legacyLead?.topic || '',
              stage: legacyLead ? String(legacyLead.stage ?? '') : '',
              source: '',
              created_at: legacyLead?.cdate || '',
              updated_at: legacyLead?.cdate || '',
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
              contactName: c.name || '',
              isMainContact: isMain,
            });
          }
        }
      });
    });

    // Step 8: Add legacy leads that don't have contacts (found during lead number search)
    // This ensures legacy leads are shown even if they don't have contacts linked
    console.log('[searchContactsSimple] Adding legacy leads without contacts:', {
      legacyLeadMapSize: legacyLeadMap.size,
      currentResultsCount: results.length,
      legacyLeadIds: Array.from(legacyLeadMap.keys())
    });
    
    if (legacyLeadMap.size > 0) {
      let addedCount = 0;
      let skippedCount = 0;
      
      legacyLeadMap.forEach((legacyLead: any, leadId: number) => {
        // Check if this legacy lead was already added via contacts
        const alreadyAdded = results.some((r: any) => 
          r.lead_type === 'legacy' && String(r.id) === String(leadId)
        );
        
        if (!alreadyAdded) {
          // Add legacy lead even without contacts
          const key = `legacy:${leadId}`;
          if (!seen.has(key)) {
            seen.add(key);
            addedCount++;
            // Format lead number with suffix for sub-leads
            let leadNumber: string;
            if (legacyLead.master_id) {
              // It's a sub-lead - calculate suffix from all legacy leads with same master_id
              const allSubLeads = Array.from(legacyLeadMap.values())
                .filter(l => l.master_id === legacyLead.master_id)
                .sort((a, b) => a.id - b.id);
              const suffix = allSubLeads.findIndex(l => l.id === legacyLead.id) + 2;
              leadNumber = `${legacyLead.master_id}/${suffix}`;
            } else {
              // It's a master lead
              leadNumber = String(legacyLead.id);
            }
            results.push({
              id: String(legacyLead.id),
              lead_number: leadNumber,
              manual_id: leadNumber,
              lead_number: String(legacyLead.id),
              manual_id: String(legacyLead.id),
              name: legacyLead.name || '',
              email: legacyLead.email || '',
              phone: legacyLead.phone || '',
              mobile: legacyLead.mobile || '',
              topic: legacyLead.topic || '',
              stage: String(legacyLead.stage ?? ''),
              source: '',
              created_at: legacyLead.cdate || '',
              updated_at: legacyLead.cdate || '',
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
              isContact: false,
              contactName: legacyLead.name || '',
              isMainContact: false,
            });
            console.log('[searchContactsSimple] Added legacy lead without contact:', {
              id: leadId,
              name: legacyLead.name
            });
          } else {
            skippedCount++;
            console.log('[searchContactsSimple] Skipped legacy lead (already seen):', leadId);
          }
        } else {
          skippedCount++;
          console.log('[searchContactsSimple] Skipped legacy lead (already added via contact):', leadId);
        }
      });
      
      console.log('[searchContactsSimple] Legacy leads addition summary:', {
        total: legacyLeadMap.size,
        added: addedCount,
        skipped: skippedCount,
        finalResultsCount: results.length
      });
    } else {
      console.log('[searchContactsSimple] No legacy leads to add (legacyLeadMap is empty)');
    }

    console.log('[searchContactsSimple] Final results:', {
      total: results.length,
      byType: {
        new: results.filter(r => r.lead_type === 'new').length,
        legacy: results.filter(r => r.lead_type === 'legacy').length
      }
    });

    return results;
  } catch (err) {
    return [];
  }
}

// -----------------------------------------------------
// MAIN SEARCH
// -----------------------------------------------------

export async function searchLeads(query: string): Promise<CombinedLead[]> {
  console.log('[searchLeads] MAIN SEARCH FUNCTION CALLED:', {
    query,
    queryLength: query.length,
    trimmed: query.trim(),
    trimmedLength: query.trim().length
  });
  
  if (!query.trim()) {
    console.log('[searchLeads] EARLY RETURN - empty query');
    return [];
  }

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);
  const hasPrefix = /^[LC]/i.test(trimmed);
  // Check if it's a pure numeric query (all digits) - could be a lead number
  const isNumeric = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
  const isPureNumeric = /^\d+$/.test(trimmed) && trimmed.length === digits.length; // No formatting/spaces
  // Phone detection: 
  // - 4+ digits starting with 0: phone (e.g., "0507")
  // - 7+ digits: always phone (lead numbers are max 6 digits)
  // - 3-6 digits that are NOT pure numeric (has formatting/spaces): phone
  const startsWithZero = digits.startsWith('0') && digits.length >= 4;
  // Lead number: has prefix OR pure numeric query with 1-6 digits (but NOT if starts with 0 and 4+ digits)
  // Lead numbers are always max 6 digits
  const isLeadNumber = hasPrefix || (isNumeric && isPureNumeric && digits.length <= 6 && !startsWithZero);
  // Phone: starts with 0 OR 7+ digits OR has formatting (not pure numeric) OR 3-6 digits that aren't lead numbers
  const isPhone = startsWithZero || digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !isNumeric && !hasPrefix);
  const isShortQuery = trimmed.length < 3; // Skip contacts for very short queries

  try {
    // For very short queries, only search new leads (skip contacts for speed)
    if (isShortQuery) {
      const newLeads = await searchNewLeadsSimple(trimmed, 30);
      return newLeads;
    }

    // If it's a lead number, search BOTH new leads AND contacts (contacts includes legacy leads!)
    if (isLeadNumber) {
      console.log('[searchLeads] Lead number detected - searching both new leads and contacts (legacy leads)');
      const [newLeads, contactLeads] = await Promise.all([
        searchNewLeadsSimple(trimmed, 30),
        searchContactsSimple(trimmed, 30), // This includes legacy leads!
      ]);
      
      console.log('[searchLeads] Lead number search results:', {
        newLeadsCount: newLeads.length,
        contactLeadsCount: contactLeads.length,
        newLeads: newLeads.map(l => ({ id: l.id, lead_number: l.lead_number, name: l.name, type: l.lead_type })),
        contactLeads: contactLeads.map(l => ({ id: l.id, lead_number: l.lead_number, name: l.name, type: l.lead_type }))
      });
      
      // Fast deduplication
      const seen = new Set<string>();
      const results: CombinedLead[] = [];

      // Add new leads first
      newLeads.forEach((lead) => {
        const key = `new:${lead.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(lead);
        }
      });

      // Add contact leads (including legacy) that aren't duplicates
      contactLeads.forEach((lead) => {
        const key = lead.lead_type === 'legacy' ? `legacy:${lead.id}` : `new:${lead.id}`;
        const contactKey = `${key}:${lead.contactName || ''}`;
        if (!seen.has(key) && !seen.has(contactKey)) {
          seen.add(contactKey);
          results.push(lead);
        }
      });

      console.log('[searchLeads] Final lead number results:', {
        total: results.length,
        byType: {
          new: results.filter(r => r.lead_type === 'new').length,
          legacy: results.filter(r => r.lead_type === 'legacy').length
        }
      });
      
      return results;
    }

    // Run searches in parallel for longer queries (optimized limits for speed)
    const [newLeads, contactLeads] = await Promise.all([
      searchNewLeadsSimple(trimmed, 30),
      searchContactsSimple(trimmed, 30),
    ]);

    // Fast deduplication
    const seen = new Set<string>();
    const results: CombinedLead[] = [];

    // Add new leads first (main leads)
    newLeads.forEach((lead) => {
      const key = `new:${lead.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(lead);
      }
    });

    // Add contacts that aren't duplicates
    contactLeads.forEach((lead) => {
      const key = `new:${lead.id}`;
      const contactKey = `${key}:${lead.contactName || ''}`;
      if (!seen.has(key) && !seen.has(contactKey)) {
        seen.add(contactKey);
        results.push(lead);
      }
    });

    // Mark and sort - simplified for speed
    results.forEach((l) => {
      const nm = (l.contactName || l.name).toLowerCase();
      const emailLower = (l.email || '').toLowerCase();
      const phoneDigits = getDigits(l.phone || '');
      const mobileDigits = getDigits(l.mobile || '');

      const exact = nm === lower || l.lead_number === trimmed || emailLower === lower ||
        (isPhone && (phoneDigits.endsWith(digits.slice(-5)) || mobileDigits.endsWith(digits.slice(-5))));
      const starts = nm.startsWith(lower) || emailLower.startsWith(lower);

      l.isFuzzyMatch = !exact && !starts;
    });

    // Fast sort
    results.sort((a, b) => {
      if (a.isFuzzyMatch !== b.isFuzzyMatch) return a.isFuzzyMatch ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Return all results (no limit) to show all matches
    return results;
  } catch (err) {
    return [];
  }
}

// -----------------------------------------------------
// Public export
// -----------------------------------------------------

/*
export async function searchLegacyLeads(query: string) {
  return searchLegacyLeadsExact(query, 20);
}
*/
