import { supabase } from './supabase';

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

// Build phone search OR condition - match by last 7 digits
// This works regardless of country code prefixes (972) or leading zeros (0)
const buildPhoneSearchOrCondition = (digits: string): string => {
  // Extract last 7 digits from the search query
  // This will match regardless of how the number is stored (with/without country code, with/without leading zero)
  let searchPattern = '';
  
  if (digits.length >= 7) {
    // Use last 7 digits - this is the key matching pattern
    searchPattern = digits.slice(-7);
  } else if (digits.length >= 5) {
    // For shorter queries (5-6 digits), use all digits
    searchPattern = digits;
  } else {
    // For very short queries (3-4 digits), use all digits
    searchPattern = digits;
  }
  
  // Build OR condition: search for this pattern in both phone and mobile columns
  // Using contains search (%pattern%) to find the digits anywhere in the number
  return `phone.ilike.%${searchPattern}%,mobile.ilike.%${searchPattern}%`;
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
  const isNumeric = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
  const isEmail = looksLikeEmail(trimmed);
  const isPhone = digits.length >= 3 && !isNumeric;

  // Minimal columns for fastest query
  const selectFields = 'id, lead_number, name, email, phone, mobile, topic, stage, created_at';

  try {
    let queryBuilder = supabase.from('leads').select(selectFields);

    if (isNumeric) {
      // Search for lead_number by matching first 4 digits (with or without L/C prefix)
      // If user types "1234", find "1234", "L1234", "C1234", "12345", "L12345", etc.
      const hasPrefix = /^[LC]/i.test(trimmed);
      const searchDigits = noPrefix.length >= 4 ? noPrefix.slice(0, 4) : noPrefix;
      
      if (hasPrefix) {
        // User typed with prefix (e.g., "L1234") - search for numbers starting with "1234"
        // Match: "L1234", "C1234", "1234", "L12345", "C12345", "12345", etc.
        queryBuilder = queryBuilder.or(`lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%,lead_number.ilike.${searchDigits}%`);
      } else {
        // User typed without prefix (e.g., "1234") - search for numbers starting with "1234"
        // Match: "1234", "L1234", "C1234", "12345", "L12345", "C12345", etc.
        queryBuilder = queryBuilder.or(`lead_number.ilike.${searchDigits}%,lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%`);
      }
    } else if (isEmail) {
      queryBuilder = queryBuilder.ilike('email', `${lower}%`);
    } else if (isPhone) {
      queryBuilder = queryBuilder.or(buildPhoneSearchOrCondition(digits));
    } else {
      // Name - starts-with for speed, works with 1+ chars
      queryBuilder = queryBuilder.ilike('name', `${lower}%`);
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
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);
  const isEmail = looksLikeEmail(trimmed);
  // Phone: 7+ digits (full phone number) OR 3-6 digits without L/C prefix (partial phone)
  // Lead number: 1-6 digits with L/C prefix, or 1-2 digits without prefix (likely lead number)
  const hasPrefix = /^[LC]/i.test(trimmed);
  // Prioritize phone: 7+ digits is definitely phone, 3-6 digits without prefix could be phone
  const isPhone = digits.length >= 7 || (digits.length >= 3 && digits.length <= 6 && !hasPrefix);
  // Lead number: has prefix OR 1-2 digits (too short for phone)
  const isLeadNumber = hasPrefix || (digits.length >= 1 && digits.length <= 2);

  try {
    let contacts: any[] = [];
    let rels: any[] = [];

    // Step 1: If searching by lead number (and NOT a phone number), find contacts via junction table first
    // But if it's 3+ digits, also search by phone (do both)
    if (isLeadNumber && digits.length < 3) {
      const searchDigits = noPrefix.length >= 4 ? noPrefix.slice(0, 4) : noPrefix;
      const hasPrefix = /^[LC]/i.test(trimmed);
      
      // First, find leads matching the lead number
      let leadQuery = supabase
        .from('leads')
        .select('id, lead_number')
        .limit(50);
      
      if (hasPrefix) {
        leadQuery = leadQuery.or(`lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%,lead_number.ilike.${searchDigits}%`);
      } else {
        leadQuery = leadQuery.or(`lead_number.ilike.${searchDigits}%,lead_number.ilike.L${searchDigits}%,lead_number.ilike.C${searchDigits}%`);
      }
      
      const { data: matchingLeads } = await leadQuery;
      const newLeadIds = matchingLeads ? matchingLeads.map((l: any) => l.id) : [];
      
      // Also check for legacy leads by ID (if numeric query matches a legacy lead ID)
      const num = parseInt(noPrefix, 10);
      const legacyLeadIds: number[] = [];
      if (!Number.isNaN(num)) {
        legacyLeadIds.push(num);
      }
      
      // Now find contacts linked to these leads via junction table
      if (newLeadIds.length > 0 || legacyLeadIds.length > 0) {
        // Query junction table for both new and legacy leads (use separate queries)
        if (newLeadIds.length > 0) {
          const { data: newRels } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, newlead_id, lead_id, main')
            .in('newlead_id', newLeadIds)
            .limit(200);
          if (newRels) rels.push(...newRels);
        }
        
        if (legacyLeadIds.length > 0) {
          const { data: legacyRels } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, newlead_id, lead_id, main')
            .in('lead_id', legacyLeadIds)
            .limit(200);
          if (legacyRels) rels.push(...legacyRels);
        }
        
        // Get contact IDs from relationships
        const contactIds = Array.from(new Set(rels.map((r: any) => r.contact_id).filter(Boolean)));
        
        if (contactIds.length > 0) {
          // Fetch the contacts
          const { data: contactsData } = await supabase
            .from('leads_contact')
            .select('id, name, email, phone, mobile, newlead_id')
            .in('id', contactIds)
            .limit(100);
          
          contacts = contactsData || [];
        }
      }
      
      if (contacts.length === 0) return [];
    }
    
    // Always search by phone if we have 3+ digits (even if also searching by lead number)
    if (digits.length >= 3 && !isEmail) {
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
        contactQuery = contactQuery.ilike('name', `%${lower}%`);
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

    // Step 3: Get direct new lead IDs
    const directNewLeadIds = Array.from(
      new Set(contacts.map((c: any) => c.newlead_id).filter((id: any) => id != null))
    );

    // Step 4: Fetch new leads for direct links
    let newLeads: any[] = [];
    if (directNewLeadIds.length > 0) {
      const { data } = await supabase
        .from('leads')
        .select('id, lead_number, topic, stage, created_at')
        .in('id', directNewLeadIds)
        .limit(limit);
      newLeads = data || [];
    }

    // Step 5: Extract legacy lead IDs and additional new lead IDs from junction table
    const legacyLeadIds = Array.from(
      new Set(rels.map((r: any) => r.lead_id).filter((id: any) => id != null))
    );

    // Fetch additional new leads from junction if any
    const newLeadIdsFromJunction = Array.from(
      new Set(rels.map((r: any) => r.newlead_id).filter((id: any) => id != null))
    );
    const additionalIds = newLeadIdsFromJunction.filter(id => !directNewLeadIds.includes(id));
    if (additionalIds.length > 0) {
      const { data } = await supabase
        .from('leads')
        .select('id, lead_number, topic, stage, created_at')
        .in('id', additionalIds)
        .limit(limit);
      if (data) newLeads.push(...data);
    }

    if (newLeads.length === 0 && legacyLeadIds.length === 0) return [];

    // Step 6: Build maps (always build, not just for longer queries)
    const newLeadMap = new Map(newLeads.map((l: any) => [l.id, l]));
    const relMap = new Map<string, any[]>();
    if (rels) {
      rels.forEach((r: any) => {
        if (!relMap.has(r.contact_id)) relMap.set(r.contact_id, []);
        relMap.get(r.contact_id)!.push(r);
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
            results.push({
              id: String(r.lead_id),
              lead_number: String(r.lead_id),
              manual_id: String(r.lead_id),
              name: c.name || '',
              email: c.email || '',
              phone: c.phone || '',
              mobile: c.mobile || '',
              topic: '',
              stage: '',
              source: '',
              created_at: '',
              updated_at: '',
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

    return results;
  } catch (err) {
    return [];
  }
}

// -----------------------------------------------------
// MAIN SEARCH
// -----------------------------------------------------

export async function searchLeads(query: string): Promise<CombinedLead[]> {
  if (!query.trim()) return [];

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const isPhone = digits.length >= 3;
  const isShortQuery = trimmed.length < 3; // Skip contacts for very short queries

  try {
    // For very short queries, only search new leads (skip contacts for speed)
    if (isShortQuery) {
      const newLeads = await searchNewLeadsSimple(trimmed, 30);
      return newLeads;
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
