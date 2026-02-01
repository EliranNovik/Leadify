const supabase = require('../config/supabase');

// Helper function to check if webhook is enabled
async function isWebhookEnabled() {
  try {
    const { data, error } = await supabase
      .from('webhook_settings')
      .select('is_active')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error checking webhook settings:', error);
      // If table doesn't exist or error, assume enabled (safe default)
      return true;
    }

    // If no settings found, assume enabled
    if (!data) {
      return true;
    }

    return data.is_active === true;
  } catch (err) {
    console.error('Error in isWebhookEnabled:', err);
    // On error, assume enabled (safe default)
    return true;
  }
}

const FACEBOOK_VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v21.0';

/**
 * Get the appropriate page access token based on page_id
 * @param {string} pageId - Facebook page ID
 * @returns {string|null} Page access token or null if not found
 */
function getPageAccessToken(pageId) {
  if (!pageId) {
    // Fallback to default token if no page_id
    return process.env.FB_PAGE_ACCESS_TOKEN || null;
  }
  
  // Try page-specific token first
  const pageSpecificToken = process.env[`FB_PAGE_ACCESS_TOKEN_${pageId}`];
  if (pageSpecificToken) {
    return pageSpecificToken;
  }
  
  // Fallback to default token
  return process.env.FB_PAGE_ACCESS_TOKEN || null;
}

/**
 * Helper to parse numeric source codes that must match misc_leadsource.code (integer)
 * Returns null if value is not a valid 32-bit integer.
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
const parseIntegerSourceCode = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null;
  if (numeric < -2147483648 || numeric > 2147483647) return null;
  return numeric;
};

/**
 * Reads FACEBOOK_FORM_SOURCE_CODES env var (JSON map) once at startup
 * Expected format: {"FORM_ID_ABC": 101, "123456789": 102}
 */
const FACEBOOK_FORM_SOURCE_CODES = (() => {
  const raw = process.env.FACEBOOK_FORM_SOURCE_CODES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    Object.keys(parsed).forEach((key) => {
      const numeric = parseIntegerSourceCode(parsed[key]);
      if (numeric === null) {
        console.warn(`⚠️ Invalid numeric source code for Facebook form mapping "${key}". Value must be a 32-bit integer.`);
        delete parsed[key];
      } else {
        parsed[key] = numeric;
      }
    });
    return parsed;
  } catch (error) {
    console.error('❌ Failed to parse FACEBOOK_FORM_SOURCE_CODES JSON:', error);
    return {};
  }
})();

const FACEBOOK_DEFAULT_SOURCE_CODE = parseIntegerSourceCode(process.env.FACEBOOK_DEFAULT_SOURCE_CODE);

const resolveSourceCodeFromIdentifier = (identifier) => {
  if (!identifier) return null;
  if (FACEBOOK_FORM_SOURCE_CODES[identifier] !== undefined) {
    return FACEBOOK_FORM_SOURCE_CODES[identifier];
  }
  return parseIntegerSourceCode(identifier);
};

/**
 * Look up language_id from misc_language table
 * Handles full text (e.g., "Hebrew", "English"), ISO codes (e.g., "HE", "EN"), and Hebrew text (e.g., "עברית")
 * @param {string} languageText - Language text, ISO code, or Hebrew text
 * @returns {Promise<number|null>} Language ID or null if not found
 */
async function lookupLanguageId(languageText) {
  if (!languageText) {
    console.log('⚠️ lookupLanguageId: Empty language text provided');
    return null;
  }
  
  console.log(`🔍 lookupLanguageId: Looking up language: "${languageText}"`);
  
  try {
    // First, try to get all languages to check for Hebrew text matches
    // Try to select name_he if it exists, but handle gracefully if it doesn't
    let allLanguages;
    let allError;
    
    try {
      const result = await supabase
        .from('misc_language')
        .select('id, name, iso_code, name_he')
        .limit(100); // Get all languages (should be a small table)
      allLanguages = result.data;
      allError = result.error;
    } catch (err) {
      // If name_he column doesn't exist, try without it
      const result = await supabase
        .from('misc_language')
        .select('id, name, iso_code')
        .limit(100);
      allLanguages = result.data;
      allError = result.error;
    }
    
    if (allError) {
      console.error('❌ Error fetching all languages:', allError);
      // Fallback to simple query
      const { data, error } = await supabase
        .from('misc_language')
        .select('id, name, iso_code')
        .or(`name.ilike.%${languageText}%,iso_code.ilike.%${languageText}%`)
        .limit(5);
      
      if (error) {
        console.error('❌ Error looking up language:', error);
        return null;
      }
      
      if (!data || data.length === 0) {
        console.log(`⚠️ Language not found: ${languageText}`);
        return null;
      }
      
      // Try exact match first (case-insensitive)
      const exactMatch = data.find(
        lang => 
          lang.name?.toUpperCase() === languageText.toUpperCase() ||
          lang.iso_code?.toUpperCase() === languageText.toUpperCase()
      );
      
      if (exactMatch) {
        console.log(`✅ Found language: ${languageText} -> ${exactMatch.id} (${exactMatch.name})`);
        return exactMatch.id;
      }
      
      // Return first match if no exact match found
      console.log(`✅ Found language (partial match): ${languageText} -> ${data[0].id} (${data[0].name})`);
      return data[0].id;
    }
    
    if (!allLanguages || allLanguages.length === 0) {
      console.log(`⚠️ No languages found in database`);
      return null;
    }
    
    console.log(`📋 Found ${allLanguages.length} languages in database`);
    
    // Normalize the input for comparison
    const normalizedInput = languageText.trim();
    
    // Check if input contains Hebrew characters (Unicode range 0590-05FF)
    const hasHebrewChars = /[\u0590-\u05FF]/.test(normalizedInput);
    
    // Special handling for "Hebrew" - map to language with iso_code "HE" or "he"
    // The database has Hebrew stored as name: "HE", iso_code: "he"
    if (normalizedInput.toUpperCase() === 'HEBREW' || normalizedInput.toLowerCase() === 'hebrew') {
      const hebrewMatch = allLanguages.find(
        lang => {
          const isoUpper = (lang.iso_code?.toUpperCase() || '').trim();
          const nameUpper = (lang.name?.toUpperCase() || '').trim();
          // Match if iso_code is "HE" or name is "HE" (the database stores Hebrew as name: "HE", iso_code: "he")
          if (isoUpper === 'HE' || nameUpper === 'HE') {
            return true;
          }
          return false;
        }
      );
      
      if (hebrewMatch) {
        console.log(`✅ Found Hebrew language: "${languageText}" -> ${hebrewMatch.id} (${hebrewMatch.name}, ${hebrewMatch.iso_code})`);
        return hebrewMatch.id;
      }
    }
    
    // Also handle Hebrew text "עברית" - map to iso_code "HE" or "he"
    if (normalizedInput === 'עברית' || normalizedInput.trim() === 'עברית') {
      const hebrewTextMatch = allLanguages.find(
        lang => {
          const isoUpper = (lang.iso_code?.toUpperCase() || '').trim();
          const nameUpper = (lang.name?.toUpperCase() || '').trim();
          // Match if iso_code is "HE" or name is "HE"
          if (isoUpper === 'HE' || nameUpper === 'HE') {
            return true;
          }
          return false;
        }
      );
      
      if (hebrewTextMatch) {
        console.log(`✅ Found Hebrew language (Hebrew text): "${languageText}" -> ${hebrewTextMatch.id} (${hebrewTextMatch.name}, ${hebrewTextMatch.iso_code})`);
        return hebrewTextMatch.id;
      }
    }
    
    // Try exact match first (case-insensitive for name and iso_code)
    const exactMatch = allLanguages.find(
      lang => {
        if (lang.name?.toUpperCase() === normalizedInput.toUpperCase()) return true;
        if (lang.iso_code?.toUpperCase() === normalizedInput.toUpperCase()) return true;
        // If input has Hebrew chars, check if it matches Hebrew name or if language is Hebrew
        if (hasHebrewChars) {
          if (lang.name_he === normalizedInput) return true;
          // If input is "עברית" and language name contains "Hebrew" or iso_code is "HE", it's a match
          if (normalizedInput === 'עברית' && (lang.name?.toLowerCase().includes('hebrew') || lang.iso_code?.toUpperCase() === 'HE')) {
            return true;
          }
        }
        return false;
      }
    );
    
    if (exactMatch) {
      console.log(`✅ Found language (exact match): "${languageText}" -> ${exactMatch.id} (${exactMatch.name}, ${exactMatch.iso_code})`);
      return exactMatch.id;
    }
    
    // Try partial match (case-insensitive)
    const partialMatch = allLanguages.find(
      lang => {
        if (lang.name?.toUpperCase().includes(normalizedInput.toUpperCase())) return true;
        if (lang.iso_code?.toUpperCase().includes(normalizedInput.toUpperCase())) return true;
        // If input has Hebrew chars, check Hebrew name
        if (hasHebrewChars && lang.name_he && lang.name_he.includes(normalizedInput)) return true;
        // If input is "עברית", match Hebrew language
        if (normalizedInput === 'עברית' && (lang.name?.toLowerCase().includes('hebrew') || lang.iso_code?.toUpperCase() === 'HE')) {
          return true;
        }
        return false;
      }
    );
    
    if (partialMatch) {
      console.log(`✅ Found language (partial match): "${languageText}" -> ${partialMatch.id} (${partialMatch.name}, ${partialMatch.iso_code})`);
      return partialMatch.id;
    }
    
    // Log all available languages for debugging
    console.log(`⚠️ Language not found: "${languageText}"`);
    console.log(`📋 Available languages in database:`, allLanguages.map(l => ({ id: l.id, name: l.name, iso_code: l.iso_code })));
    
    // Try one more time with a more flexible match for "Hebrew"
    if (normalizedInput.toLowerCase().includes('hebrew') || normalizedInput.toUpperCase() === 'HE') {
      const flexibleHebrewMatch = allLanguages.find(
        lang => {
          const nameLower = lang.name?.toLowerCase() || '';
          const isoUpper = lang.iso_code?.toUpperCase() || '';
          return nameLower.includes('hebrew') || isoUpper === 'HE';
        }
      );
      
      if (flexibleHebrewMatch) {
        console.log(`✅ Found Hebrew language (flexible match): "${languageText}" -> ${flexibleHebrewMatch.id} (${flexibleHebrewMatch.name}, ${flexibleHebrewMatch.iso_code})`);
        return flexibleHebrewMatch.id;
      }
    }
    
    console.log(`⚠️ Returning null for language: "${languageText}" - SQL function will try to look it up`);
    return null;
  } catch (error) {
    console.error('Exception looking up language:', error);
    return null;
  }
}

/**
 * Look up country_id from misc_country table by ISO code
 * @param {string} countryIsoCode - Country ISO code (e.g., "IL", "US")
 * @returns {Promise<number|null>} Country ID or null if not found
 */
async function lookupCountryId(countryIsoCode) {
  if (!countryIsoCode) {
    console.log('⚠️ lookupCountryId: Empty country ISO code provided');
    return null;
  }
  
  const normalizedIsoCode = countryIsoCode.trim().toUpperCase();
  console.log(`🔍 lookupCountryId: Looking up country with ISO code: "${normalizedIsoCode}"`);
  
  try {
    // Fetch all countries and filter client-side for reliable case-insensitive matching
    // This is more reliable than using .ilike which might have issues
    const { data: allCountries, error } = await supabase
      .from('misc_country')
      .select('id, name, iso_code')
      .limit(300); // Get all countries (should be less than 300)
    
    if (error) {
      console.error('❌ Error fetching countries:', error);
      return null;
    }
    
    if (!allCountries || allCountries.length === 0) {
      console.log(`⚠️ No countries found in database`);
      return null;
    }
    
    // Find exact match (case-insensitive)
    const match = allCountries.find(
      country => {
        const countryIso = (country.iso_code || '').trim().toUpperCase();
        return countryIso === normalizedIsoCode;
      }
    );
    
    if (match) {
      console.log(`✅ Found country: "${normalizedIsoCode}" -> ${match.id} (${match.name}, ${match.iso_code})`);
      return match.id;
    }
    
    console.log(`⚠️ Country not found for ISO code: "${normalizedIsoCode}"`);
    console.log(`📋 Available country ISO codes (first 10):`, allCountries.slice(0, 10).map(c => c.iso_code));
    return null;
  } catch (error) {
    console.error('❌ Exception looking up country:', error);
    return null;
  }
}

/**
 * Fetch lead details from Facebook Graph API using leadgen_id
 * @param {string} leadgenId - The leadgen_id from the webhook
 * @param {string} pageId - The page_id from the webhook (used to select correct token)
 * @returns {Promise<Object>} Lead details with field_data
 */
async function fetchLeadDetailsFromGraph(leadgenId, pageId) {
  const accessToken = getPageAccessToken(pageId);
  
  if (!accessToken) {
    throw new Error(`No page access token found for page_id: ${pageId || 'unknown'}. Please configure FB_PAGE_ACCESS_TOKEN_${pageId} or FB_PAGE_ACCESS_TOKEN`);
  }

  const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${leadgenId}?fields=field_data,created_time,ad_id,form_id,page_id&access_token=${accessToken}`;
  
  console.log(`🔍 Fetching lead details from Graph API for leadgen_id: ${leadgenId}, page_id: ${pageId}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Facebook Graph API error ${response.status}: ${errorText}`);
  }
  
  const leadDetails = await response.json();
  console.log(`✅ Successfully fetched lead details:`, JSON.stringify(leadDetails, null, 2));
  
  return leadDetails;
}

const webhookController = {
  /**
   * Catch form data and create a new lead
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async catchFormData(req, res) {
    try {
      console.log('📥 Received webhook data:', req.body);
      
      // Check if webhook is enabled
      const webhookEnabled = await isWebhookEnabled();
      if (!webhookEnabled) {
        console.log('⛔ Webhook is disabled. Rejecting incoming request.');
        return res.status(503).json({ 
          success: false,
          error: 'Webhook endpoint is currently disabled',
          message: 'The webhook is temporarily unavailable. Please try again later or contact support.'
        });
      }
      
      // Handle nested query object (some webhook providers send data nested in 'query')
      // Also check req.query for URL query parameters
      // Fallback order: req.body.query -> req.body (if not empty) -> req.query
      // Note: req.body can be {} (empty object) which is truthy, so we need to check if it has keys
      let bodyData;
      if (req.body?.query && Object.keys(req.body.query).length > 0) {
        bodyData = req.body.query;
      } else if (req.body && Object.keys(req.body).length > 0) {
        bodyData = req.body;
      } else if (req.query && Object.keys(req.query).length > 0) {
        bodyData = req.query;
      } else {
        bodyData = {};
      }
      
      // Debug logging to help diagnose issues
      console.log('🔍 Webhook body data extraction:', {
        hasBodyQuery: !!req.body.query,
        hasBody: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        bodyKeysLength: req.body ? Object.keys(req.body).length : 0,
        hasQuery: !!req.query,
        queryKeys: req.query ? Object.keys(req.query) : [],
        bodyDataKeys: bodyData ? Object.keys(bodyData) : [],
        bodyDataName: bodyData?.name,
        bodyDataEmail: bodyData?.email,
        bodyDataSource: bodyData === req.body.query ? 'req.body.query' : (bodyData === req.body ? 'req.body' : (bodyData === req.query ? 'req.query' : 'null'))
      });
      
      // Log the received form data
      // Accept both 'source_code' and 'lead_source' as aliases
      const sourceCodeValue = bodyData?.source_code || bodyData?.lead_source;
      const parsedSourceCode = parseIntegerSourceCode(sourceCodeValue);
      
      // Accept both 'facts' and 'desc' as aliases - prioritize desc if present
      const factsValue = (bodyData?.desc || bodyData?.facts) || null;
      
      // Extract country ISO code - check top-level fields first, then parse from facts field
      let countryIsoCode = (bodyData?.country || bodyData?.ISO) || null;
      
      // If country not found in top-level fields, try to extract from facts field
      if (!countryIsoCode && factsValue) {
        // Look for patterns like "Country: IL" or "Country:IL" or "Country IL"
        const countryMatch = factsValue.match(/Country\s*:?\s*([A-Z]{2})/i);
        if (countryMatch && countryMatch[1]) {
          countryIsoCode = countryMatch[1].toUpperCase();
          console.log('🌍 Extracted country from facts field:', countryIsoCode);
        }
      }
      
      // Extract language (can be full text, ISO code, or Hebrew text)
      const languageText = bodyData?.language || 'English';
      
      // Extract source URL - check url, ref_url, or if source looks like a URL, then parse from facts
      let sourceUrl = null;
      if (bodyData?.url) {
        sourceUrl = bodyData.url;
      } else if (bodyData?.ref_url) {
        sourceUrl = bodyData.ref_url;
      } else if (bodyData?.source && (bodyData.source.startsWith('http://') || bodyData.source.startsWith('https://'))) {
        // If source field is a URL, use it as source_url
        sourceUrl = bodyData.source;
      } else if (factsValue) {
        // Try to extract URL from facts field (look for "Source URL: ..." pattern)
        const urlMatch = factsValue.match(/Source\s+URL\s*:?\s*(https?:\/\/[^\s\n]+)/i);
        if (urlMatch && urlMatch[1]) {
          sourceUrl = urlMatch[1].trim();
          console.log('🔗 Extracted source URL from facts field:', sourceUrl);
        }
      }

      const formData = {
        name: bodyData?.name,
        email: bodyData?.email,
        phone: bodyData?.phone,
        topic: bodyData?.topic,
        facts: factsValue,
        source: bodyData?.source || 'webhook',
        language: languageText,
        country: countryIsoCode,
        source_url: sourceUrl,
        source_code: parsedSourceCode
      };

      // Log all extracted form data for debugging
      console.log('📋 Extracted form data:', {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        topic: formData.topic,
        facts: formData.facts,
        source: formData.source,
        source_url: formData.source_url,
        language: formData.language,
        country: formData.country,
        source_code: formData.source_code,
        allBodyDataKeys: bodyData ? Object.keys(bodyData) : [],
        bodyData: bodyData
      });

      // Validate required fields
      if (!formData.name) {
        console.error('❌ Missing required fields:', {
          name: formData.name,
          email: formData.email,
          bodyData,
          reqBody: req.body
        });
        return res.status(400).json({ 
          error: 'Missing required fields: name is required' 
        });
      }

      // Check for duplicate leads - check both leads table and leads_contact table
      const duplicateFields = [];
      let existingLead = null;

      // Normalize name for comparison (trim and lowercase)
      const normalizeName = (name) => {
        if (!name) return '';
        return name.trim().toLowerCase();
      };
      const normalizedNewName = normalizeName(formData.name);

      // Check leads table for email, phone, or name matches
      if (formData.email || formData.phone || formData.name) {
        let leadsQuery = supabase
          .from('leads')
          .select('id, name, email, phone, created_at');
        
        const conditions = [];
        if (formData.email) conditions.push(`email.eq.${formData.email}`);
        if (formData.phone) conditions.push(`phone.eq.${formData.phone}`);
        if (formData.name) conditions.push(`name.ilike.%${formData.name}%`);
        
        if (conditions.length > 0) {
          leadsQuery = leadsQuery.or(conditions.join(','));
        }
        
        const { data: leadsMatches, error: leadsError } = await leadsQuery
          .order('created_at', { ascending: false })
          .limit(5); // Get more results to check name matches

        if (leadsError) {
          console.error('Error checking leads for duplicates:', leadsError);
        } else if (leadsMatches && leadsMatches.length > 0) {
          // Check each match to find exact duplicates
          for (const lead of leadsMatches) {
            let isMatch = false;
            
            // Check email match
            if (formData.email && lead.email && lead.email.toLowerCase() === formData.email.toLowerCase()) {
              duplicateFields.push('email');
              isMatch = true;
            }
            
            // Check phone match
            if (formData.phone && lead.phone && lead.phone === formData.phone) {
              duplicateFields.push('phone');
              isMatch = true;
            }
            
            // Check name match (normalized comparison)
            if (formData.name && lead.name && normalizeName(lead.name) === normalizedNewName) {
              duplicateFields.push('name');
              isMatch = true;
            }
            
            // If we found a match and don't have an existing lead yet, use this one
            if (isMatch && !existingLead) {
              existingLead = lead;
              break; // Use the first match
            }
          }
        }
      }

      // Check leads_contact table for email, phone, mobile, or name matches
      if (formData.email || formData.phone || formData.name) {
        let contactsQuery = supabase
          .from('leads_contact')
          .select('newlead_id, name, email, phone, mobile');
        
        const contactConditions = [];
        if (formData.email) contactConditions.push(`email.eq.${formData.email}`);
        if (formData.phone) {
          contactConditions.push(`phone.eq.${formData.phone}`);
          contactConditions.push(`mobile.eq.${formData.phone}`);
        }
        if (formData.name) {
          contactConditions.push(`name.ilike.%${formData.name}%`);
        }
        
        if (contactConditions.length > 0) {
          contactsQuery = contactsQuery.or(contactConditions.join(','));
        }
        
        const { data: contactsMatches, error: contactsError } = await contactsQuery.limit(5);

        if (contactsError) {
          console.error('Error checking contacts for duplicates:', contactsError);
        } else if (contactsMatches && contactsMatches.length > 0) {
          // Check each contact match
          for (const contact of contactsMatches) {
            let foundMatch = false;
            
            // If we don't have an existing lead yet, fetch it
            if (!existingLead && contact.newlead_id) {
              const { data: leadData } = await supabase
                .from('leads')
                .select('id, name, email, phone, created_at')
                .eq('id', contact.newlead_id)
                .single();
              
              if (leadData) {
                existingLead = leadData;
                foundMatch = true;
              }
            }
            
            // Add matching fields
            if (formData.email && contact.email && contact.email.toLowerCase() === formData.email.toLowerCase() && !duplicateFields.includes('email')) {
              duplicateFields.push('email');
              foundMatch = true;
            }
            if (formData.phone && contact.phone && contact.phone === formData.phone && !duplicateFields.includes('phone')) {
              duplicateFields.push('phone');
              foundMatch = true;
            }
            if (formData.phone && contact.mobile && contact.mobile === formData.phone && !duplicateFields.includes('mobile')) {
              duplicateFields.push('mobile');
              foundMatch = true;
            }
            // Check name match in contact
            if (formData.name && contact.name && normalizeName(contact.name) === normalizedNewName && !duplicateFields.includes('name')) {
              duplicateFields.push('name');
              foundMatch = true;
            }
            
            // If we found a match, break after first one
            if (foundMatch) {
              break;
            }
          }
        }
      }

      // If we have an existing lead, also check if names match
      if (existingLead && formData.name && existingLead.name) {
        if (normalizeName(existingLead.name) === normalizedNewName && !duplicateFields.includes('name')) {
          duplicateFields.push('name');
        }
      }

      // If we haven't found a lead yet but have a name, do a name-only search
      if (!existingLead && formData.name) {
        const { data: nameMatches, error: nameError } = await supabase
          .from('leads')
          .select('id, name, email, phone, created_at')
          .ilike('name', `%${formData.name}%`)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!nameError && nameMatches && nameMatches.length > 0) {
          // Find exact name match
          for (const lead of nameMatches) {
            if (lead.name && normalizeName(lead.name) === normalizedNewName) {
              existingLead = lead;
              duplicateFields.push('name');
              break;
            }
          }
        }

        // Also check leads_contact table for name matches
        if (!existingLead) {
          const { data: contactNameMatches, error: contactNameError } = await supabase
            .from('leads_contact')
            .select('newlead_id, name')
            .ilike('name', `%${formData.name}%`)
            .limit(5);

          if (!contactNameError && contactNameMatches && contactNameMatches.length > 0) {
            for (const contact of contactNameMatches) {
              if (contact.name && normalizeName(contact.name) === normalizedNewName && contact.newlead_id) {
                const { data: leadData } = await supabase
                  .from('leads')
                  .select('id, name, email, phone, created_at')
                  .eq('id', contact.newlead_id)
                  .single();
                
                if (leadData) {
                  existingLead = leadData;
                  duplicateFields.push('name');
                  break;
                }
              }
            }
          }
        }
      }

      // If we found a duplicate, store it in double_leads table
      if (existingLead && duplicateFields.length > 0) {
        console.log('⚠️ Duplicate lead detected:', {
          existingLeadId: existingLead.id,
          duplicateFields,
          newLeadData: formData
        });

        // Prepare the new lead data with all form fields
        const newLeadData = {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          topic: formData.topic,
          source: formData.source || 'Webhook',
          language: formData.language || 'English',
          facts: formData.facts || null,
          comments: formData.comments || null
        };

        // Look up source_id and category_id from source_code if available
        let sourceId = null;
        let categoryId = null;
        
        if (parsedSourceCode !== null) {
          try {
            const { data: sourceData, error: sourceError } = await supabase
              .from('misc_leadsource')
              .select('id, default_category_id')
              .eq('code', parsedSourceCode)
              .eq('active', true)
              .single();
            
            if (!sourceError && sourceData) {
              sourceId = sourceData.id;
              categoryId = sourceData.default_category_id;
              console.log('📋 Looked up source_id and category_id:', { sourceId, categoryId, sourceCode: parsedSourceCode });
            }
          } catch (error) {
            console.error('Error looking up source_id and category_id:', error);
          }
        }

        const { error: doubleLeadError } = await supabase
          .from('double_leads')
          .insert([{
            new_lead_data: newLeadData,
            existing_lead_id: existingLead.id,
            duplicate_fields: duplicateFields,
            status: 'pending',
            source_id: sourceId,
            category_id: categoryId
          }]);

        if (doubleLeadError) {
          console.error('Error storing double lead:', doubleLeadError);
          // Continue to create the lead anyway if storing fails
        } else {
          console.log('✅ Duplicate lead stored in double_leads table for review');
          return res.status(200).json({ 
            success: true,
            duplicate: true,
            message: 'Potential duplicate detected. Lead stored for review.',
            existing_lead_id: existingLead.id,
            duplicate_fields: duplicateFields
          });
        }
      }

      // Look up language_id and country_id before creating the lead
      const languageId = await lookupLanguageId(formData.language);
      const countryId = await lookupCountryId(formData.country);
      
      console.log('🔍 Language and Country lookups:', {
        languageText: formData.language,
        languageId,
        countryIsoCode: formData.country,
        countryId,
        sourceUrl: formData.source_url
      });

      // Create new lead using the source validation function
      // Pass language_id and country_id directly if we found them
      const rpcParams = {
        p_lead_name: formData.name,
        p_lead_email: formData.email,
        p_lead_phone: formData.phone || null,
        p_lead_topic: formData.topic || null,
        p_lead_language: formData.language || 'EN',
        p_lead_source: formData.source || 'Webhook',
        p_created_by: 'webhook@system',
        p_source_code: formData.source_code || null,
        p_balance_currency: 'NIS',
        p_proposal_currency: 'NIS',
        p_language_id: languageId || null,
        p_country_id: countryId || null,
        p_source_url: formData.source_url || null
      };
      
      console.log('📤 Calling create_lead_with_source_validation with params:', JSON.stringify(rpcParams, null, 2));
      
      const { data: newLead, error: insertError } = await supabase.rpc('create_lead_with_source_validation', rpcParams);

      if (insertError) {
        console.error('❌ Error creating lead:', insertError);
        console.error('❌ Error details:', JSON.stringify(insertError, null, 2));
        return res.status(500).json({ 
          error: 'Failed to create lead',
          details: insertError.message 
        });
      }

      if (!newLead || newLead.length === 0) {
        console.error('No lead data returned from function');
        return res.status(500).json({ error: 'Failed to create lead - no data returned' });
      }

      const createdLead = newLead[0];
      console.log('✅ Lead created successfully:', createdLead);

      // If facts data is provided, update the lead with facts
      if (formData.facts) {
        try {
          const { error: factsError } = await supabase
            .from('leads')
            .update({ facts: formData.facts })
            .eq('id', createdLead.id);

          if (factsError) {
            console.error('Error updating facts:', factsError);
          } else {
            console.log('✅ Facts updated successfully');
          }
        } catch (factsError) {
          console.error('Error updating facts:', factsError);
        }
      }

      res.status(201).json({ 
        success: true, 
        data: {
          lead_number: createdLead.lead_number,
          id: createdLead.id,
          name: createdLead.name,
          email: createdLead.email,
          source_id: createdLead.source_id,
          source_name: createdLead.source_name,
          final_topic: createdLead.final_topic,
          final_category_id: createdLead.final_category_id,
          created_at: new Date().toISOString()
        },
        message: 'Lead created successfully' 
      });

    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * Get webhook statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWebhookStats(req, res) {
    try {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('created_at, source')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
        .eq('source', 'Web Form');

      if (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch webhook statistics'
        });
      }

      res.status(200).json({
        success: true,
        data: {
          total_leads_last_24h: leads.length,
          leads: leads
        }
      });

    } catch (error) {
      console.error('❌ Error fetching webhook stats:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  /**
   * Facebook webhook verification handler
   */
  async verifyFacebookWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!FACEBOOK_VERIFY_TOKEN) {
      console.error('VERIFY_TOKEN is not configured');
      return res.status(500).send('VERIFY_TOKEN is not configured');
    }

    if (mode === 'subscribe' && token === FACEBOOK_VERIFY_TOKEN) {
      console.log('✅ Facebook webhook verified successfully');
      return res.status(200).send(challenge || 'OK');
    }

    console.warn('❌ Facebook webhook verification failed');
    return res.status(403).send('Verification failed');
  },

  /**
   * Handle Facebook lead webhook payload
   * Facebook sends only leadgen_id in the webhook - we must fetch field_data from Graph API
   */
  async handleFacebookLead(req, res) {
    // Log immediately when handler is called - VERY VISIBLE
    console.log('='.repeat(80));
    console.log('🎯🎯🎯 FACEBOOK WEBHOOK HANDLER CALLED 🎯🎯🎯');
    console.log('🎯 Time:', new Date().toISOString());
    console.log('🎯 Request method:', req.method);
    console.log('🎯 Request path:', req.path);
    console.log('🎯 Request URL:', req.originalUrl || req.url);
    console.log('🎯 Request body type:', typeof req.body);
    console.log('🎯 Request body:', JSON.stringify(req.body, null, 2));
    console.log('='.repeat(80));
    
    // Check if webhook is enabled BEFORE acknowledging to Facebook
    const webhookEnabled = await isWebhookEnabled();
    if (!webhookEnabled) {
      console.log('⛔ Webhook is disabled. Rejecting Facebook lead webhook.');
      return res.status(503).json({ 
        success: false,
        error: 'Webhook endpoint is currently disabled'
      });
    }
    
    // Always acknowledge to Facebook immediately to prevent retries
    // We'll process asynchronously
    res.status(200).json({ received: true });
    
    try {
      // Facebook payload is nested - get first change
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value || !value.leadgen_id) {
        console.warn('⚠️ No leadgen_id in Facebook webhook payload. Webhook acknowledged but no lead created.');
        return;
      }

      const leadgenId = value.leadgen_id;
      const formId = value.form_id;
      const pageId = value.page_id;

      console.log(`📥 Processing Facebook lead: leadgen_id=${leadgenId}, form_id=${formId}, page_id=${pageId}`);

      // Fetch lead details from Graph API
      let leadDetails;
      try {
        leadDetails = await fetchLeadDetailsFromGraph(leadgenId, pageId);
      } catch (graphError) {
        console.error(`❌ Failed to fetch lead details from Graph API for leadgen_id ${leadgenId}, page_id ${pageId}:`, graphError);
        return; // Already acknowledged, just log and exit
      }

      const fieldData = leadDetails.field_data || [];

      // Helper function to extract field values from Facebook field_data array
      const getField = (fieldName) => {
        const field = fieldData.find(f => f.name === fieldName);
        if (!field || !Array.isArray(field.values) || field.values.length === 0) return null;
        return field.values[0];
      };

      // Log all available field names for debugging
      const availableFieldNames = fieldData.map(f => f.name);
      console.log('📋 Available Facebook field names:', availableFieldNames);

      // Extract fields from Facebook payload
      const firstName = getField('first_name');
      const lastName = getField('last_name');
      const fullName = getField('full_name') || getField('name');
      const name = fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);

      const email = getField('email');
      const about =
        getField('about') ||
        getField('additional_info') ||
        getField('message') ||
        null;

      const phone = getField('phone_number') || getField('phone') || null;
      
      // Try multiple variations of source_code field name (Facebook may send it with spaces, underscores, etc.)
      const sourceCodeRaw = 
        getField('source_code') || 
        getField('source code') || 
        getField('source-code') ||
        getField('sourceCode') ||
        getField('source_code_value') ||
        null;
      
      console.log('🔍 Looking for source_code, found raw value:', sourceCodeRaw);
      
      const sourceCodeFromField = parseIntegerSourceCode(sourceCodeRaw);

      // Determine numeric source code (required by misc_leadsource.code)
      const sourceCodeFromForm = resolveSourceCodeFromIdentifier(formId);
      const sourceCodeFromLeadgen = sourceCodeFromField === null && sourceCodeFromForm === null
        ? resolveSourceCodeFromIdentifier(leadgenId)
        : null;
      const source_code = sourceCodeFromField
        ?? sourceCodeFromForm
        ?? sourceCodeFromLeadgen
        ?? FACEBOOK_DEFAULT_SOURCE_CODE;

      const sourceResolutionDetails = {
        form_id: formId,
        leadgen_id: leadgenId,
        source_code_field_value: sourceCodeRaw,
        from_source_code_field: sourceCodeFromField,
        from_form_id: sourceCodeFromForm,
        from_leadgen_id: sourceCodeFromLeadgen,
        fallback_default: FACEBOOK_DEFAULT_SOURCE_CODE,
        all_field_names: availableFieldNames
      };

      if (!name || !email) {
        console.warn('⚠️ Missing required fields (name/email) after fetching lead details:', {
          name,
          email,
          source_code,
          about,
          phone,
          availableFields: availableFieldNames,
          sourceResolutionDetails
        });
        return; // Already acknowledged, just log and exit
      }

      if (!source_code) {
        console.warn('⚠️ Missing source_code. Lead will be created without source validation:', {
          name,
          email,
          sourceResolutionDetails
        });
        // Continue anyway - the function will handle null source_code
      }

      console.log('📥 Mapped Facebook lead:', {
        source_code,
        about,
        email,
        name,
        phone,
        sourceResolutionDetails
      });

      const { data: newLead, error: insertError } = await supabase.rpc('create_lead_with_source_validation', {
        p_lead_name: name,
        p_lead_email: email.toLowerCase(),
        p_lead_phone: phone || null,
        p_lead_topic: about || null,
        p_lead_language: 'EN',
        p_lead_source: 'Facebook',
        p_created_by: 'facebook@webhook',
        p_source_code: source_code,
        p_balance_currency: 'NIS',
        p_proposal_currency: 'NIS'
      });

      if (insertError) {
        console.error('❌ Error creating Facebook lead:', insertError);
        return; // Already acknowledged, just log and exit
      }

      if (!newLead || newLead.length === 0) {
        console.error('❌ No lead data returned from Facebook webhook insertion');
        return; // Already acknowledged, just log and exit
      }

      const createdLead = newLead[0];
      console.log('✅ Facebook lead created successfully:', {
        lead_number: createdLead.lead_number,
        id: createdLead.id,
        name: createdLead.name,
        email: createdLead.email,
        source_id: createdLead.source_id,
        source_name: createdLead.source_name
      });
    } catch (error) {
      console.error('❌ Facebook webhook processing error:', error);
      // Already acknowledged, just log and exit
    }
  }
};

module.exports = webhookController; 