const supabase = require('../config/supabase');

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
      
      // Log the received form data
      const parsedSourceCode = parseIntegerSourceCode(req.body.source_code);

      const formData = {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        topic: req.body.topic,
        facts: req.body.facts,
        source: req.body.source || 'webhook',
        language: req.body.language || 'English',
        source_code: parsedSourceCode
      };

      // Validate required fields
      if (!formData.name || !formData.email) {
        return res.status(400).json({ 
          error: 'Missing required fields: name and email are required' 
        });
      }

      // Check for duplicate leads
      const { data: existingLeads, error: checkError } = await supabase
        .from('leads')
        .select('id, name, email, phone, created_at')
        .or(`email.eq.${formData.email},phone.eq.${formData.phone}`)
        .order('created_at', { ascending: false })
        .limit(5);

      if (checkError) {
        console.error('Error checking for duplicates:', checkError);
        return res.status(500).json({ error: 'Database error' });
      }

      // Check for recent duplicates (within last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentDuplicates = existingLeads?.filter(lead => 
        new Date(lead.created_at) > oneDayAgo
      ) || [];

      if (recentDuplicates.length > 0) {
        // Store duplicate for review
        const duplicateData = {
          original_lead_id: recentDuplicates[0].id,
          duplicate_data: formData,
          created_at: new Date().toISOString()
        };

        const { error: duplicateError } = await supabase
          .from('duplicate_leads')
          .insert([duplicateData]);

        if (duplicateError) {
          console.error('Error storing duplicate:', duplicateError);
        }

        return res.status(409).json({ 
          error: 'Duplicate lead detected',
          message: 'A lead with this email or phone already exists'
        });
      }

      // Create new lead using the source validation function
      const { data: newLead, error: insertError } = await supabase.rpc('create_lead_with_source_validation', {
        p_lead_name: formData.name,
        p_lead_email: formData.email,
        p_lead_phone: formData.phone || null,
        p_lead_topic: formData.topic || null,
        p_lead_language: formData.language || 'EN',
        p_lead_source: formData.source || 'Webhook',
        p_created_by: 'webhook@system',
        p_source_code: formData.source_code || null,
        p_balance_currency: 'NIS',
        p_proposal_currency: 'NIS'
      });

      if (insertError) {
        console.error('Error creating lead:', insertError);
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