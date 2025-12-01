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

// Build phone search OR condition - match by last 5-7 digits
// This is fast and works regardless of country code prefixes or formatting
const buildPhoneSearchOrCondition = (digits: string): string => {
  // Use last 5-7 digits for matching (works for any phone number format)
  // If user types "0507825939", we search for "7825939" (last 7) or "82593" (last 5)
  // This will match "972507825939" (contains the pattern) or "0507825939" (contains the pattern)
  let searchPattern = digits;
  
  // More flexible pattern matching:
  // - 7+ digits: use last 7 for better precision
  // - 5-6 digits: use last 5 for good matching
  // - 3-4 digits: use all digits (more responsive when typing fast)
  // - Less than 3: use all digits (shouldn't happen, but handle gracefully)
  if (digits.length >= 7) {
    searchPattern = digits.slice(-7); // Last 7 digits for better precision
  } else if (digits.length >= 5) {
    searchPattern = digits.slice(-5); // Last 5 digits
  } else {
    // For 3-4 digits, use all digits to be more responsive when typing fast
    searchPattern = digits;
  }
  
  // Simple search: match the pattern in phone and mobile columns
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
// New leads simple search
// -----------------------------------------------------

async function searchNewLeadsSimple(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const noPrefix = stripLeadPrefix(trimmed);
  const isNumeric = /^\d+$/.test(noPrefix) && noPrefix.length > 0;
  const isEmail = looksLikeEmail(trimmed);
  // Phone: detect if query is mostly digits (3+ digits) and not a pure number (which would be lead number)
  const isPhone = digits.length >= 3 && !isNumeric;

  const results: any[] = [];
  const seen = new Set<string>();

  if (isNumeric) {
    // Lead number search - exact match
    const num = noPrefix;
    const { data } = await supabase
        .from('leads')
      .select('*')
      .eq('lead_number', num)
      .limit(limit);
    
    if (data) {
      data.forEach((row: any) => {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row);
        }
      });
    }
  } else if (isEmail) {
    // Email search - starts-with and contains
    const [starts, contains] = await Promise.all([
      supabase
        .from('leads')
        .select('*')
        .ilike('email', `${lower}%`)
        .limit(limit),
      supabase
        .from('leads')
        .select('*')
        .ilike('email', `%${lower}%`)
        .limit(limit),
    ]);

    for (const row of starts.data || []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push(row);
      }
    }

    for (const row of contains.data || []) {
      if (!seen.has(row.id) && results.length < limit) {
        seen.add(row.id);
        results.push(row);
      }
    }
  } else if (isPhone) {
    // Phone search - search for phone/mobile numbers containing the digits in sequence
    // Handles country codes: numbers stored as "972507825939" when user types "0507825939"
    if (digits.length >= 3) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .or(buildPhoneSearchOrCondition(digits))
        .limit(limit);
      
      if (data) {
        data.forEach((row: any) => {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            results.push(row);
          }
        });
      }
    }
  } else {
    // Name search - starts-with and contains
    const [starts, contains] = await Promise.all([
      supabase
        .from('leads')
        .select('*')
        .ilike('name', `${lower}%`)
        .limit(limit),
      trimmed.length >= 2
        ? supabase.from('leads').select('*').ilike('name', `%${lower}%`).limit(limit)
        : Promise.resolve({ data: [] }),
    ]);

    for (const row of starts.data || []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push(row);
      }
    }

    for (const row of contains.data || []) {
      if (!seen.has(row.id) && results.length < limit) {
        seen.add(row.id);
        results.push(row);
      }
    }
  }

  return results.map((lead: any) => ({
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
    lead_type: 'new',
          unactivation_reason: null,
          deactivate_note: null,
          isFuzzyMatch: false,
        }));
}

// -----------------------------------------------------
// Legacy exact search
// -----------------------------------------------------

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

// -----------------------------------------------------
// Contacts search
// -----------------------------------------------------

async function searchContactsSimple(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return []; // Require at least 2 characters

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const isEmail = looksLikeEmail(trimmed);
  // Phone: require at least 3 digits (same as new leads search for consistency)
  // The buildPhoneSearchOrCondition will use appropriate pattern matching
  const isPhone = digits.length >= 3;
  let contacts: any[] = [];

  try {
    if (isPhone && !isEmail) {
      // Phone search - search leads_contact table only
      // Handle country codes: numbers are often stored as "972507825939" when user types "0507825939"
      // Use dynamic timeout based on digit count - more digits = longer timeout for better results
      const timeoutMs = digits.length >= 7 ? 3000 : digits.length >= 5 ? 2500 : 2000;
      try {
        const { data, error } = await withTimeout(
          (async () => {
            return await supabase
              .from('leads_contact')
              .select('*')
              .or(buildPhoneSearchOrCondition(digits))
              .limit(50); // Increased limit to show more phone matches
          })(),
          timeoutMs, // Dynamic timeout based on digit count
          'leads_contact phone timeout'
        );
        
        if (error) {
          console.warn('[searchContactsSimple] Phone search error:', error);
          contacts = [];
        } else {
          contacts = data || [];
            }
          } catch (err) {
        console.warn('[searchContactsSimple] Phone search failed:', err);
        contacts = [];
      }
    } else if (isEmail) {
      // Email search - search leads_contact table only
      const { data, error } = await withTimeout(
        (async () => {
          return await supabase
                .from('leads_contact')
            .select('*')
            .ilike('email', `${lower}%`)
            .limit(limit);
        })(),
        300,
        'leads_contact email timeout'
      );
      
      if (error) {
        console.warn('[searchContactsSimple] Email search error:', error);
        contacts = [];
          } else {
        contacts = data || [];
      }
          } else {
      // Name search - search leads_contact table only
      // This is the primary way to find legacy leads by name (via junction table)
      if (trimmed.length < 3) return []; // Skip very short name queries
      
      const { data, error } = await withTimeout(
        (async () => {
          return await supabase
            .from('leads_contact')
            .select('*')
            .ilike('name', `${lower}%`)
            .limit(30);  // Increased limit to find more contacts (which link to legacy leads)
        })(),
        3000,  // Increased to 3 seconds timeout for name search
        'leads_contact name timeout'
      );
      
      if (error) {
        console.warn('[searchContactsSimple] Name search error:', error);
        contacts = [];
          } else {
        contacts = data || [];
      }
    }
      } catch (err) {
    // Silently fail - return empty results
    console.warn('[searchContactsSimple] Search failed:', err);
    return [];
  }

  if (!contacts.length) return [];

  const results: CombinedLead[] = [];
  const contactIds = contacts.map((c: any) => c.id);

  // Get relationships from lead_leadcontact junction table
  const { data: rels } = await supabase
          .from('lead_leadcontact')
    .select('contact_id, newlead_id, lead_id, main')
    .in('contact_id', contactIds)
    .limit(500); // Increased limit to handle more contacts

  // Also get new leads directly linked via leads_contact.newlead_id
  const directNewLeadIds = Array.from(
    new Set(contacts.map((c: any) => c.newlead_id).filter((id: any) => id != null))
  );

  // Collect all lead IDs
  const newLeadIdsFromJunction = rels
    ? Array.from(new Set(rels.map((r: any) => r.newlead_id).filter((id: any) => id != null)))
    : [];
  const allNewLeadIds = Array.from(new Set([...newLeadIdsFromJunction, ...directNewLeadIds]));
  const legacyLeadIds = rels
    ? Array.from(new Set(rels.map((r: any) => r.lead_id).filter((id: any) => id != null)))
    : [];

  // Fetch all leads in parallel
  const [newRows, legacyRows] = await Promise.all([
    allNewLeadIds.length > 0
      ? supabase
          .from('leads')
          .select('*')
          .in('id', allNewLeadIds)
          .limit(500) // Increased limit to show more results
      : Promise.resolve({ data: [] }),
    legacyLeadIds.length > 0
      ? supabase
          .from('leads_lead')
          .select('*')
          .in('id', legacyLeadIds)
          .limit(500) // Increased limit to show more results
      : Promise.resolve({ data: [] }),
  ]);

  const newMap = new Map((newRows.data || []).map((x: any) => [x.id, x]));
  const legMap = new Map((legacyRows.data || []).map((x: any) => [x.id, x]));

  // Process contacts linked via junction table
  if (rels && rels.length > 0) {
    rels.forEach((r: any) => {
      const c = contacts.find((x: any) => x.id === r.contact_id);
      if (!c) return;

      const isMain = r.main === true || r.main === 'true';

      // New lead via junction table
      if (r.newlead_id && newMap.has(r.newlead_id)) {
        const l = newMap.get(r.newlead_id);
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
          lead_type: 'new',
              unactivation_reason: null,
              deactivate_note: null,
              isFuzzyMatch: false,
              isContact: !isMain,
          contactName: c.name || '',
              isMainContact: isMain,
        });
      }

      // Legacy lead via junction table
      if (r.lead_id && legMap.has(r.lead_id)) {
        const l = legMap.get(r.lead_id);
        const leadNum = l.lead_number ? String(l.lead_number) : String(l.id);

        results.push({
          id: String(l.id),
          lead_number: leadNum,
          manual_id: leadNum,
          name: c.name || '',
          email: c.email || '',
          phone: c.phone || '',
          mobile: c.mobile || '',
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
            isContact: !isMain,
          contactName: c.name || '',
            isMainContact: isMain,
        });
      }
    });
  }

  // Process contacts directly linked via leads_contact.newlead_id (not in junction table)
  contacts.forEach((c: any) => {
    if (c.newlead_id && newMap.has(c.newlead_id)) {
      // Check if we already added this via junction table
      const alreadyAdded = results.some(
        (r) => r.id === c.newlead_id && r.contactName === c.name
      );
      if (alreadyAdded) return;

      const l = newMap.get(c.newlead_id);
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
        lead_type: 'new',
            unactivation_reason: null,
            deactivate_note: null,
            isFuzzyMatch: false,
        isContact: true, // Direct link, assume not main
        contactName: c.name || '',
        isMainContact: false,
      });
    }
  });

  return results;
}

// -----------------------------------------------------
// MAIN SEARCH
// -----------------------------------------------------

export async function searchLeads(query: string): Promise<CombinedLead[]> {
  if (!query.trim()) return [];

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  try {
    const newLeads = await withTimeout(
      searchNewLeadsSimple(trimmed, 20),
      1500,
      'new timeout',
    ).catch(() => []);

    const [contactRes, legacyRes] = await Promise.allSettled([
      withTimeout(searchContactsSimple(trimmed, 50), 3000, 'contacts timeout'), // Increased timeout to allow name searches
      withTimeout(searchLegacyLeadsExact(trimmed, 20), 5500, 'legacy timeout'), // Increased to 5.5s to allow name searches to complete
    ]);

    const contactLeads =
      contactRes.status === 'fulfilled' ? contactRes.value : [];
    const legacyLeads =
      legacyRes.status === 'fulfilled' ? legacyRes.value : [];

    const mainMap = new Map<string, CombinedLead>();
    const contactMap = new Map<string, CombinedLead>();

    const add = (lead: CombinedLead) => {
      const key = `${lead.lead_type}:${lead.id}`;
      if (!lead.isContact) {
        if (!mainMap.has(key)) mainMap.set(key, lead);
      } else {
        const ck = key + ':' + (lead.contactName || '');
        if (!contactMap.has(ck)) contactMap.set(ck, lead);
      }
    };

    newLeads.forEach(add);
    legacyLeads.forEach(add);
    contactLeads.forEach(add);

    const results: CombinedLead[] = [];

    const mainKeys = new Set(mainMap.keys());
    mainMap.forEach((l) => results.push(l));

    contactMap.forEach((l) => {
      const mk = `${l.lead_type}:${l.id}`;
      if (!mainKeys.has(mk)) results.push(l);
    });

    results.forEach((l) => {
      const nm = (l.contactName || l.name).toLowerCase();
      const exact =
        nm === lower ||
        l.lead_number === trimmed ||
        (l.email && l.email.toLowerCase() === lower);

      const starts = nm.startsWith(lower);

      l.isFuzzyMatch = !exact && !starts;
    });

    results.sort((a, b) => {
      const na = (a.contactName || a.name).toLowerCase();
      const nb = (b.contactName || b.name).toLowerCase();

      const exA =
        na === lower ||
        a.lead_number === trimmed ||
        (a.email && a.email.toLowerCase() === lower);
      const exB =
        nb === lower ||
        b.lead_number === trimmed ||
        (b.email && b.email.toLowerCase() === lower);

      if (exA && !exB) return -1;
      if (exB && !exA) return 1;

      const stA = na.startsWith(lower);
      const stB = nb.startsWith(lower);

      if (stA && !stB) return -1;
      if (stB && !stA) return 1;

      if (a.lead_type === 'new' && b.lead_type === 'legacy') return -1;
      if (b.lead_type === 'new' && a.lead_type === 'legacy') return 1;

      return (
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
      );
    });

    return results.slice(0, 20);
  } catch {
      return [];
  }
}

// -----------------------------------------------------
// Public export
// -----------------------------------------------------

export async function searchLegacyLeads(query: string) {
  return searchLegacyLeadsExact(query, 20);
}
