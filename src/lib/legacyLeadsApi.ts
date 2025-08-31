import { supabase } from './supabase';



// Interface for legacy leads from leads_lead table
export interface LegacyLead {
  id: bigint;
  cdate: string | null;
  udate: string | null;
  name: string | null;
  topic: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  special_notes: string | null;
  notes: string | null;
  meeting_datetime: string | null;
  meeting_location_old: string | null;
  meeting_url: string | null;
  meeting_total: string | null;
  meeting_fop: string | null;
  probability: string | null;
  total: string | null;
  meeting_brief: string | null;
  next_followup: string | null;
  file_id: string | null;
  first_payment: string | null;
  creator_id: string | null;
  currency_id: bigint | null;
  case_handler_id: string | null;
  firm_id: bigint | null;
  language_id: bigint | null;
  meeting_lawyer_id: string | null;
  meeting_manager_id: string | null;
  meeting_scheduler_id: string | null;
  meeting_total_currency_id: bigint | null;
  source_id: bigint | null;
  stage: bigint | null;
  stage_date: string | null;
  status: bigint | null;
  description: string | null;
  auto: string | null;
  source_external_id: string | null;
  source_url: string | null;
  marketing_data: string | null;
  category: string | null;
  ball: bigint | null;
  additional_emails: string | null;
  additional_phones: string | null;
  meeting_collection_id: string | null;
  meeting_paid: string | null;
  proposal: string | null;
  priority: bigint | null;
  meeting_date: string | null;
  meeting_time: string | null;
  followup_log: string | null;
  initial_probability: string | null;
  meeting_complexity: bigint | null;
  meeting_car_no: string | null;
  meeting_probability: string | null;
  proposed_solution: string | null;
  meeting_confirmation: string | null;
  meeting_location_id: string | null;
  meeting_id: string | null;
  meeting_scheduling_notes: string | null;
  deactivate_notes: string | null;
  old_reason: string | null;
  vat: string | null;
  legal_potential: string | null;
  revenue_potential: string | null;
  desired_location: string | null;
  financial_ability: bigint | null;
  seriousness: bigint | null;
  external_notes: string | null;
  exclusive_handler_id: string | null;
  eligibile: string | null;
  anchor_full_name: string | null;
  total_base: string | null;
  bonus_paid: string | null;
  autocall: string | null;
  eligibilty_date: string | null;
  no_of_applicants: bigint | null;
  anchor_id: string | null;
  manual_id: string | null;
  master_id: string | null;
  closer_id: string | null;
  expert_id: string | null;
  potential_applicants: string | null;
  reason_id: string | null;
  latest_interaction: string | null;
  expert_examination: string | null;
  expert_opinion: string | null;
  sales_roles_locked: string | null;
  expiry_date: string | null;
  docs_url: string | null;
  vat_value: string | null;
  vat_value_base: string | null;
  handler_expert_opinion: string | null;
  management_notes: string | null;
  kind: string | null;
  dependent: string | null;
  potential_total: string | null;
  potential_total_base: string | null;
  category_id: bigint | null;
  lead_number: bigint | null;
}

// Interface for new leads from leads table
export interface NewLead {
  id: string;
  lead_number: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  topic: string | null;
  stage: string | null;
  source: string | null;
  created_at: string | null;
  special_notes: string | null;
  category: string | null;
  // Add other fields as needed
}

// Combined interface for both legacy and new leads
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
  unactivation_reason?: string | null;
  deactivate_note?: string | null; // For legacy leads
  isFuzzyMatch?: boolean; // Flag to indicate if this is a fuzzy match
}

// Fuzzy search function to handle typos and minor spelling mistakes
function fuzzyMatch(query: string, text: string): boolean {
  if (!text) return false;
  
  const queryLower = query.toLowerCase().trim();
  const textLower = text.toLowerCase().trim();
  
  // Exact match (highest priority)
  if (textLower.includes(queryLower)) return true;
  
  // If query is too short, don't do fuzzy matching
  if (queryLower.length < 2) return false;
  
  // For short queries (2-3 chars), be more lenient
  if (queryLower.length <= 3) {
    const distance = levenshteinDistance(queryLower, textLower);
    return distance <= 1; // Allow 1 character difference for short queries
  }
  
  // Calculate Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(queryLower, textLower);
  const maxDistance = Math.max(1, Math.floor(queryLower.length * 0.4)); // Allow 40% difference, minimum 1
  
  return distance <= maxDistance;
}

// Levenshtein distance algorithm for fuzzy string matching
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Enhanced search function with fuzzy matching
function searchWithFuzzyMatching(results: any[], query: string, searchFields: string[]): any[] {
  const trimmedQuery = query.trim();
  
  // First, try exact matches (higher priority)
  const exactMatches = results.filter(result => 
    searchFields.some(field => {
      const value = result[field];
      return value && value.toLowerCase().includes(trimmedQuery.toLowerCase());
    })
  );
  
  // Then, try fuzzy matches (lower priority) and mark them
  const fuzzyMatches = results.filter(result => 
    !exactMatches.includes(result) && // Don't include exact matches again
    searchFields.some(field => {
      const value = result[field];
      if (!value) return false;
      
      const isFuzzy = fuzzyMatch(trimmedQuery, value);
      return isFuzzy;
    })
  ).map(result => ({
    ...result,
    isFuzzyMatch: true // Mark as fuzzy match
  }));
  
  // Combine results with exact matches first, then fuzzy matches
  return [...exactMatches, ...fuzzyMatches];
}

// Fetch all leads from both tables
export async function fetchAllLeads(): Promise<CombinedLead[]> {
  try {
    // Fetch from legacy table with currency information
    const { data: legacyLeads, error: legacyError } = await supabase
      .from('leads_lead')
      .select(`
        *,
        accounting_currencies!leads_lead_currency_id_fkey (
          name,
          iso_code
        )
      `)
      .order('cdate', { ascending: false });

    if (legacyError) {
      console.error('Error fetching legacy leads:', legacyError);
    }

    // Fetch from new table
    const { data: newLeads, error: newError } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (newError) {
      console.error('Error fetching new leads:', newError);
    }

    // Transform legacy leads
    const transformedLegacyLeads: CombinedLead[] = (legacyLeads || []).map(lead => ({
      id: `legacy_${lead.id}`,
      lead_number: String(lead.id), // Always use id as lead_number for legacy leads
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      mobile: lead.mobile || '',
      topic: lead.topic || '',
      stage: String(lead.stage || ''),
      source: String(lead.source_id || ''),
      created_at: lead.cdate || '',
      updated_at: lead.udate || '',
      notes: lead.notes || '',
      special_notes: lead.special_notes || '',
      next_followup: lead.next_followup || '',
      probability: String(lead.probability || ''),
      category: String(lead.category_id || lead.category || ''),
      language: String(lead.language_id || ''),
      balance: String(lead.total || ''),
      lead_type: 'legacy' as const,
      unactivation_reason: lead.unactivation_reason || null,
      deactivate_note: lead.deactivate_note || null,
    }));

    // Transform new leads
    const transformedNewLeads: CombinedLead[] = (newLeads || []).map(lead => ({
      id: lead.id,
      lead_number: lead.lead_number || '',
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      mobile: lead.mobile || '',
      topic: lead.topic || '',
      stage: lead.stage || '',
      source: lead.source || '',
      created_at: lead.created_at || '',
      updated_at: lead.created_at || '',
      notes: lead.notes || '',
      special_notes: lead.special_notes || '',
      next_followup: lead.next_followup || '',
      probability: String(lead.probability || ''),
      category: lead.category || '',
      language: lead.language || '',
      balance: String(lead.balance || ''),
      lead_type: 'new' as const,
      unactivation_reason: lead.unactivation_reason || null,
    }));

    const allLeads = [...transformedLegacyLeads, ...transformedNewLeads];
    return allLeads.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  } catch (error) {
    console.error('Error fetching all leads:', error);
    return [];
  }
}

// Fetch lead by ID (supports both legacy and new leads)
export async function fetchLeadById(id: string): Promise<CombinedLead | null> {
  try {
    
    // Check if it's a legacy lead
    if (id.startsWith('legacy_')) {
      const legacyId = parseInt(id.replace('legacy_', ''));
      const { data: legacyLead, error: legacyError } = await supabase
        .from('leads_lead')
        .select('*')
        .eq('id', legacyId)
        .single();

      if (legacyError) {
        console.error('Error fetching legacy lead:', legacyError);
        return null;
      }

      return {
        id: `legacy_${legacyLead.id}`,
        lead_number: String(legacyLead.id), // Always use id as lead_number for legacy leads
        name: legacyLead.name || '',
        email: legacyLead.email || '',
        phone: legacyLead.phone || '',
        mobile: legacyLead.mobile || '',
        topic: legacyLead.topic || '',
        stage: String(legacyLead.stage || ''),
        source: String(legacyLead.source_id || ''),
        created_at: legacyLead.cdate || '',
        updated_at: legacyLead.udate || '',
        notes: legacyLead.notes || '',
        special_notes: legacyLead.special_notes || '',
        next_followup: legacyLead.next_followup || '',
        probability: String(legacyLead.probability || ''),
        category: String(legacyLead.category_id || legacyLead.category || ''),
        language: String(legacyLead.language_id || ''),
        balance: String(legacyLead.total || ''),
        lead_type: 'legacy' as const,
        unactivation_reason: legacyLead.unactivation_reason || null,
        deactivate_note: legacyLead.deactivate_note || null,
      };
    } else {
      // It's a new lead
      const { data: newLead, error: newError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .single();

      if (newError) {
        console.error('Error fetching new lead:', newError);
        return null;
      }

      return {
        id: newLead.id,
        lead_number: newLead.lead_number || '',
        name: newLead.name || '',
        email: newLead.email || '',
        phone: newLead.phone || '',
        mobile: newLead.mobile || '',
        topic: newLead.topic || '',
        stage: newLead.stage || '',
        source: newLead.source || '',
        created_at: newLead.created_at || '',
        updated_at: newLead.created_at || '',
        notes: newLead.notes || '',
        special_notes: newLead.special_notes || '',
        next_followup: newLead.next_followup || '',
        probability: String(newLead.probability || ''),
        category: newLead.category || '',
        language: newLead.language || '',
        balance: String(newLead.balance || ''),
        lead_type: 'new' as const,
        unactivation_reason: newLead.unactivation_reason || null,
      };
    }
  } catch (error) {
    console.error('Error fetching lead by ID:', error);
    return null;
  }
}

// Search leads in both tables with performance optimizations and fuzzy matching
export async function searchLeads(query: string): Promise<CombinedLead[]> {
  try {
    // Don't search if query is too short
    if (!query || query.trim().length < 2) {
      return [];
    }

    const trimmedQuery = query.trim();
    const results: CombinedLead[] = [];

    // Search in both tables concurrently with limits
    const [legacyPromise, newPromise] = await Promise.allSettled([
      // Search legacy leads with limit - fetch more results for fuzzy matching
      (async () => {
        let legacyQuery = supabase
          .from('leads_lead')
          .select('id, name, email, phone, mobile, topic, stage, cdate, lead_number')
          .limit(20); // Increased limit for fuzzy matching
        
        // If query is a number, try exact ID match first
        if (!isNaN(Number(trimmedQuery))) {
          const numQuery = parseInt(trimmedQuery);
          return await legacyQuery.eq('id', numQuery);
        } else {
          // Much broader search to capture potential matches for fuzzy processing
          // Split query into words and search for partial matches
          const words = trimmedQuery.split(' ').filter(word => word.length > 0);
          let searchConditions = [];
          
          // Search for the full query
          searchConditions.push(`name.ilike.%${trimmedQuery}%`);
          searchConditions.push(`email.ilike.%${trimmedQuery}%`);
          searchConditions.push(`phone.ilike.%${trimmedQuery}%`);
          searchConditions.push(`mobile.ilike.%${trimmedQuery}%`);
          searchConditions.push(`topic.ilike.%${trimmedQuery}%`);
          
          // Also search for individual words
          words.forEach(word => {
            if (word.length >= 2) {
              searchConditions.push(`name.ilike.%${word}%`);
              searchConditions.push(`email.ilike.%${word}%`);
              searchConditions.push(`phone.ilike.%${word}%`);
              searchConditions.push(`mobile.ilike.%${word}%`);
              searchConditions.push(`topic.ilike.%${word}%`);
            }
          });
          
          return await legacyQuery.or(searchConditions.join(','));
        }
      })(),
      
      // Search new leads with limit - fetch more results for fuzzy matching
      (async () => {
        // Much broader search to capture potential matches for fuzzy processing
        const words = trimmedQuery.split(' ').filter(word => word.length > 0);
        let searchConditions = [];
        
        // Search for the full query
        searchConditions.push(`lead_number.ilike.%${trimmedQuery}%`);
        searchConditions.push(`name.ilike.%${trimmedQuery}%`);
        searchConditions.push(`email.ilike.%${trimmedQuery}%`);
        searchConditions.push(`phone.ilike.%${trimmedQuery}%`);
        searchConditions.push(`mobile.ilike.%${trimmedQuery}%`);
        
        // Also search for individual words
        words.forEach(word => {
          if (word.length >= 2) {
            searchConditions.push(`lead_number.ilike.%${word}%`);
            searchConditions.push(`name.ilike.%${word}%`);
            searchConditions.push(`email.ilike.%${word}%`);
            searchConditions.push(`phone.ilike.%${word}%`);
            searchConditions.push(`mobile.ilike.%${word}%`);
          }
        });
        
        return await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .or(searchConditions.join(','))
          .limit(20) // Increased limit for fuzzy matching
          .order('created_at', { ascending: false });
      })()
    ]);

    // Process legacy results with fuzzy matching
    if (legacyPromise.status === 'fulfilled' && legacyPromise.value.data) {
      let processedLegacyResults;
      
      // If query is a number, don't apply fuzzy matching - use exact results
      if (!isNaN(Number(trimmedQuery))) {
        processedLegacyResults = legacyPromise.value.data;
      } else {
        // Apply fuzzy matching to legacy results for text queries
        processedLegacyResults = searchWithFuzzyMatching(
          legacyPromise.value.data, 
          trimmedQuery, 
          ['name', 'email', 'phone', 'mobile', 'topic']
        );
      }

      const transformedLegacyLeads: CombinedLead[] = processedLegacyResults.map(lead => ({
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
      }));
      results.push(...transformedLegacyLeads);
    }

    // Process new results with fuzzy matching
    if (newPromise.status === 'fulfilled' && newPromise.value.data) {
      let processedNewResults;
      
      // If query is a number, don't apply fuzzy matching - use exact results
      if (!isNaN(Number(trimmedQuery))) {
        processedNewResults = newPromise.value.data;
      } else {
        // Apply fuzzy matching to new results for text queries
        processedNewResults = searchWithFuzzyMatching(
          newPromise.value.data, 
          trimmedQuery, 
          ['lead_number', 'name', 'email', 'phone', 'mobile', 'topic']
        );
      }

      const transformedNewLeads: CombinedLead[] = processedNewResults.map(lead => ({
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
      }));
      results.push(...transformedNewLeads);
    }

    // Sort by creation date and return top results
    return results
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 15); // Return max 15 results total

  } catch (error) {
    console.error('Error searching leads:', error);
    return [];
  }
}
