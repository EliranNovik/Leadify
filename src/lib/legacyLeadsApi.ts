import { supabase } from './supabase';

// Legacy leads from leads_lead table
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

// New leads from leads table
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

// Unified lead type returned by search
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
  status?: string | number | null;
  isFuzzyMatch: boolean;
  isContact?: boolean;
  contactName?: string;
  isMainContact?: boolean;
}

// Simple cache for whole search results
const searchCache = new Map<string, { results: CombinedLead[]; timestamp: number }>();
const CACHE_DURATION = 30_000;

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      searchCache.delete(key);
    }
  }
}, 60_000);

// Helpers
const normalizeQuery = (q: string) => q.trim().toLowerCase();
const getDigits = (q: string) => q.replace(/\D/g, '');
const looksLikeEmail = (q: string) => q.includes('@');

// Strip optional L/C prefix from lead number
const stripLeadPrefix = (q: string) => q.replace(/^[LC]/i, '');

// Timeout wrapper
const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    }),
  ]) as Promise<T>;
};

/**
 * Fetch a single lead (new or legacy) by id
 * legacy ids are passed as "legacy_<id>" or just numeric string
 */
export async function fetchLeadById(leadId: string): Promise<CombinedLead | null> {
  try {
    // Legacy id with explicit prefix
    if (leadId.startsWith('legacy_')) {
      const numericId = leadId.replace('legacy_', '');

      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, cdate')
        .eq('id', numericId)
        .single();

      if (error || !data) {
        console.error('Error fetching legacy lead', error);
        return null;
      }

      const leadNumber =
        data.lead_number != null ? String(data.lead_number) : String(data.id);

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

    // New lead (uuid)
    const { data, error } = await supabase
      .from('leads')
      .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
      .eq('id', leadId)
      .single();

    if (error || !data) {
      console.error('Error fetching new lead', error);
      return null;
    }

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
  } catch (err) {
    console.error('Error in fetchLeadById', err);
    return null;
  }
}

/**
 * Fetch latest new leads (used for listing)
 * Legacy is excluded here on purpose for speed
 */
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

/**
 * New leads search - optimized for instant fuzzy results
 * Shows fuzzy matches immediately, exact matches prioritized in sort
 */
async function searchNewLeadsSimple(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 1) return [];
  
  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const emailQuery = looksLikeEmail(trimmed);
  const numericQuery = /^\d+$/.test(stripLeadPrefix(trimmed)) && stripLeadPrefix(trimmed).length > 0;

  const results: any[] = [];
  const seenIds = new Set<string>();

  // Run fuzzy search immediately (fast, shows results as typing)
  if (emailQuery) {
    // Email fuzzy search (uses idx_leads_email_lower)
    const { data } = await supabase
      .from('leads')
      .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
      .ilike('email', `%${lower}%`)  // Contains for instant results
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (data) {
      data.forEach((lead: any) => {
        if (!seenIds.has(lead.id)) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
  } else if (numericQuery) {
    // Lead number - run all queries in PARALLEL for instant results
    const noPrefix = stripLeadPrefix(trimmed);
    
    // Run exact, noPrefix, fuzzy, and phone searches in parallel
    const [exactResult, noPrefixResult, fuzzyResult, phoneResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .eq('lead_number', trimmed)
        .limit(limit),
      noPrefix !== trimmed
        ? supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .eq('lead_number', noPrefix)
            .limit(limit)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .ilike('lead_number', `%${noPrefix}%`)
        .order('created_at', { ascending: false })
        .limit(limit),
      digits.length >= 5
        ? supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .or(`phone.ilike.%${digits}%,mobile.ilike.%${digits}%`)
            .order('created_at', { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [], error: null }),
    ]);
    
    // Add exact matches first
    if (exactResult.data) {
      exactResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id)) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
    
    // Add noPrefix matches
    if (noPrefixResult.data) {
      noPrefixResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id) && results.length < limit) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
    
    // Add fuzzy matches
    if (fuzzyResult.data && results.length < limit) {
      fuzzyResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id) && results.length < limit) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
    
    // Add phone matches
    if (phoneResult.data && results.length < limit) {
      phoneResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id) && results.length < limit) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
  } else {
    // Name search - run starts-with and contains in PARALLEL for instant results
    // This gives instant results while typing
    const [startsWithResult, containsResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .ilike('name', `${lower}%`)  // Starts-with (fast, uses index efficiently)
        .order('created_at', { ascending: false })
        .limit(limit),
      trimmed.length >= 2
        ? supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
            .ilike('name', `%${lower}%`)  // Contains (fuzzy)
            .order('created_at', { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [], error: null }),
    ]);
    
    // Add starts-with results first (better matches)
    if (startsWithResult.data) {
      startsWithResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id)) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
    }
    
    // Add contains results (fuzzy matches) if we have room
    if (containsResult.data && results.length < limit) {
      containsResult.data.forEach((lead: any) => {
        if (!seenIds.has(lead.id) && results.length < limit) {
          results.push(lead);
          seenIds.add(lead.id);
        }
      });
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
    lead_type: 'new' as const,
    unactivation_reason: null,
    deactivate_note: null,
    isFuzzyMatch: false, // Will be determined in sorting
    isContact: false,
    contactName: undefined,
    isMainContact: false,
  }));
}

/**
 * Exact, index based legacy search
 * Only for numeric id / lead_number style queries
 */
async function searchLegacyLeadsExact(query: string, limit = 20): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const noPrefix = stripLeadPrefix(trimmed);
  const digits = getDigits(noPrefix);

  if (!digits || !/^\d+$/.test(digits)) {
    // Names, phones and emails for legacy are handled via contacts search
    return [];
  }

  const num = parseInt(digits, 10);
  if (Number.isNaN(num)) return [];

  const { data, error } = await supabase
    .from('leads_lead')
    .select('id, manual_id, lead_number, name, email, phone, mobile, topic, stage, cdate')
    .or(`id.eq.${num},lead_number.eq.${num}`)
    .order('cdate', { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) console.warn('[searchLegacyLeadsExact] error', error);
    return [];
  }

  return data.map((row: any) => {
    const leadNumber =
      row.lead_number != null ? String(row.lead_number) : String(row.id);

    return {
      id: String(row.id),
      lead_number: leadNumber,
      manual_id: row.manual_id ? String(row.manual_id) : leadNumber,
      name: row.name || '',
      email: row.email || '',
      phone: row.phone || '',
      mobile: row.mobile || '',
      topic: row.topic || '',
      stage: String(row.stage ?? ''),
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
      isContact: false,
      contactName: undefined,
      isMainContact: false,
    };
  });
}

/**
 * Contact based search - instant fuzzy results
 * Shows fuzzy matches immediately as user types
 */
async function searchContactsSimple(
  query: string,
  limit = 30,
): Promise<CombinedLead[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 1) return [];

  const lower = trimmed.toLowerCase();
  const digits = getDigits(trimmed);
  const emailQuery = looksLikeEmail(trimmed);

  // 1. Find contacts - run fuzzy search immediately for instant results
  let contacts: any[] = [];
  
  if (emailQuery) {
    // Email fuzzy search (uses idx_leads_contact_email_lower)
    const { data } = await supabase
      .from('leads_contact')
      .select('id, name, email, phone, mobile')
      .ilike('email', `%${lower}%`)  // Contains for instant results
      .limit(limit);
    if (data) contacts = data;
  } else if (digits.length >= 5) {
    // Phone fuzzy search (uses idx_leads_contact_phone_digits or idx_leads_contact_mobile_digits)
    const { data } = await supabase
      .from('leads_contact')
      .select('id, name, email, phone, mobile')
      .or(`phone.ilike.%${digits}%,mobile.ilike.%${digits}%`)
      .limit(limit);
    if (data) contacts = data;
  } else if (trimmed.length >= 1) {
    // Name search - run fuzzy search immediately for instant results
    const { data } = await supabase
      .from('leads_contact')
      .select('id, name, email, phone, mobile')
      .ilike('name', `%${lower}%`)  // Contains for instant fuzzy results
      .limit(limit);
    
    if (data) {
      contacts = data;
    }
  }

  if (contacts.length === 0) return [];

  const contactIds = contacts.map((c: any) => c.id);

  // 2. Look up relationships (uses idx_lead_leadcontact_contact_id)
  const { data: relations } = await supabase
    .from('lead_leadcontact')
    .select('contact_id, newlead_id, lead_id, main')
    .in('contact_id', contactIds)
    .limit(200);

  if (!relations || relations.length === 0) return [];

  // Group by lead to avoid duplicates
  const newLeadIds = Array.from(new Set(relations.map((r: any) => r.newlead_id).filter((id: any) => id != null)));
  const legacyLeadIds = Array.from(new Set(relations.map((r: any) => r.lead_id).filter((id: any) => id != null)));

  // 3. Fetch leads in parallel (fast)
  const [newLeadsResult, legacyLeadsResult] = await Promise.all([
    newLeadIds.length > 0
      ? supabase
          .from('leads')
          .select('id, lead_number, name, topic, stage, created_at')
          .in('id', newLeadIds)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    legacyLeadIds.length > 0
      ? supabase
          .from('leads_lead')
          .select('id, manual_id, lead_number, name, topic, stage, cdate')
          .in('id', legacyLeadIds)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const newLeadsMap = new Map<string, any>();
  (newLeadsResult.data || []).forEach((l: any) => newLeadsMap.set(l.id, l));

  const legacyLeadsMap = new Map<number, any>();
  (legacyLeadsResult.data || []).forEach((l: any) => legacyLeadsMap.set(l.id, l));

  // 4. Build results
  const results: CombinedLead[] = [];
  const seenLeadKeys = new Set<string>();

  relations.forEach((rel: any) => {
    const contact = contacts.find((c: any) => c.id === rel.contact_id);
    if (!contact) return;

    const isMain = rel.main === 'true' || rel.main === true;

    if (rel.newlead_id && newLeadsMap.has(rel.newlead_id)) {
      const lead = newLeadsMap.get(rel.newlead_id);
      const key = `new:${lead.id}:${contact.id}`;
      
      if (!seenLeadKeys.has(key)) {
        seenLeadKeys.add(key);
        results.push({
          id: lead.id,
          lead_number: lead.lead_number || '',
          manual_id: lead.lead_number || null,
          name: contact.name || '',
          email: contact.email || '',
          phone: contact.phone || '',
          mobile: contact.mobile || '',
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
          isContact: !isMain,
          contactName: contact.name || '',
          isMainContact: isMain,
        });
      }
    }

    if (rel.lead_id && legacyLeadsMap.has(rel.lead_id)) {
      const lead = legacyLeadsMap.get(rel.lead_id);
      const leadNumber = lead.lead_number != null ? String(lead.lead_number) : String(lead.id);
      const key = `legacy:${lead.id}:${contact.id}`;
      
      if (!seenLeadKeys.has(key)) {
        seenLeadKeys.add(key);
        results.push({
          id: String(lead.id),
          lead_number: leadNumber,
          manual_id: lead.manual_id ? String(lead.manual_id) : leadNumber,
          name: contact.name || '',
          email: contact.email || '',
          phone: contact.phone || '',
          mobile: contact.mobile || '',
          topic: lead.topic || '',
          stage: String(lead.stage ?? ''),
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
          lead_type: 'legacy',
          unactivation_reason: null,
          deactivate_note: null,
          isFuzzyMatch: false,
          isContact: !isMain,
          contactName: contact.name || '',
          isMainContact: isMain,
        });
      }
    }
  });

  return results;
}

/**
 * Main search: new leads + contacts (prioritized for speed)
 * Legacy exact search only for numeric queries
 * Optimized for instant results as user types
 */
export async function searchLeads(query: string): Promise<CombinedLead[]> {
  if (!query || query.trim().length < 1) return [];

  const trimmed = query.trim();
  const normalized = normalizeQuery(trimmed);

  // Skip cache for instant results - cache can cause stale results
  // const cached = searchCache.get(normalized);
  // if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
  //   return cached.results;
  // }

  try {
    // Prioritize new leads (fastest) - return immediately
    // Only do legacy search for numeric queries (lead numbers) - skip for text to speed up
    const isNumericQuery = /^[LC]?\d+$/.test(trimmed);
    
    // Get new leads first (fastest, instant results)
    const newLeads = await searchNewLeadsSimple(trimmed, 20);
    
    // Get contacts and legacy with VERY SHORT timeout (300ms max) - prioritize speed
    // Use Promise.allSettled to get results even if one fails
    const [contactLeadsResult, legacyLeadsResult] = await Promise.allSettled([
      withTimeout(searchContactsSimple(trimmed, 20), 300, 'contacts timeout').catch(() => []),
      isNumericQuery
        ? withTimeout(searchLegacyLeadsExact(trimmed, 10), 300, 'legacy timeout').catch(() => [])
        : Promise.resolve([]),
    ]);
    
    const contactLeads = contactLeadsResult.status === 'fulfilled' ? contactLeadsResult.value : [];
    const legacyLeads = legacyLeadsResult.status === 'fulfilled' ? legacyLeadsResult.value : [];

    const all: CombinedLead[] = [];

    // Main leads map (one entry per lead)
    const mainMap = new Map<string, CombinedLead>();
    // Contacts map, key is lead id + contact name
    const contactMap = new Map<string, CombinedLead>();

    const addMain = (lead: CombinedLead) => {
      const key = `${lead.lead_type}:${lead.id}`;
      if (!lead.isContact) {
        if (!mainMap.has(key)) {
          mainMap.set(key, lead);
        }
      } else {
        if (!contactMap.has(key + ':' + (lead.contactName || ''))) {
          contactMap.set(key + ':' + (lead.contactName || ''), lead);
        }
      }
    };

    newLeads.forEach(addMain);
    legacyLeads.forEach(addMain);
    contactLeads.forEach(addMain);

    // Build final list: all main leads first, then contacts for leads that do not have a main entry
    const finalResults: CombinedLead[] = [];

    const mainKeys = new Set(mainMap.keys());
    mainMap.forEach((lead) => finalResults.push(lead));

    contactMap.forEach((lead, key) => {
      const mainKey = `${lead.lead_type}:${lead.id}`;
      if (!mainKeys.has(mainKey)) {
        finalResults.push(lead);
      }
    });

    // Sort by relevance - exact matches on top, fuzzy below
    const lower = normalized;
    
    // Mark fuzzy matches
    finalResults.forEach((lead) => {
      const name = (lead.contactName || lead.name || '').toLowerCase();
      const isExact =
        name === lower ||
        lead.lead_number === trimmed ||
        (lead.email && lead.email.toLowerCase() === lower) ||
        lead.phone === trimmed ||
        lead.mobile === trimmed;
      const isStarts = name.startsWith(lower);
      lead.isFuzzyMatch = !isExact && !isStarts;
    });

    finalResults.sort((a, b) => {
      const aName = (a.contactName || a.name || '').toLowerCase();
      const bName = (b.contactName || b.name || '').toLowerCase();

      // Exact matches first (highest priority)
      const aExact =
        aName === lower ||
        a.lead_number === trimmed ||
        (a.email && a.email.toLowerCase() === lower) ||
        a.phone === trimmed ||
        a.mobile === trimmed;
      const bExact =
        bName === lower ||
        b.lead_number === trimmed ||
        (b.email && b.email.toLowerCase() === lower) ||
        b.phone === trimmed ||
        b.mobile === trimmed;

      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;

      // Starts with second
      const aStarts = aName.startsWith(lower);
      const bStarts = bName.startsWith(lower);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;

      // New leads prioritized over legacy
      if (a.lead_type === 'new' && b.lead_type === 'legacy') return -1;
      if (a.lead_type === 'legacy' && b.lead_type === 'new') return 1;

      // Then by date (newest first)
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });

    const limited = finalResults.slice(0, 20);
    // Skip cache for instant results
    // searchCache.set(normalized, { results: limited, timestamp: Date.now() });
    return limited;
  } catch (err) {
    console.error('Error in searchLeads', err);
    return [];
  }
}

/**
 * Public legacy search export, now just the exact, fast version
 */
export async function searchLegacyLeads(query: string): Promise<CombinedLead[]> {
  return searchLegacyLeadsExact(query, 20);
}
