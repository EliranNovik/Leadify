const supabase = require('../config/supabase');

const FACEBOOK_VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
      const formData = {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        topic: req.body.topic,
        facts: req.body.facts,
        source: req.body.source || 'webhook',
        language: req.body.language || 'English',
        source_code: req.body.source_code || null
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
   */
  async handleFacebookLead(req, res) {
    try {
      if (!FACEBOOK_VERIFY_TOKEN) {
        console.error('VERIFY_TOKEN is not configured');
        return res.status(500).json({ error: 'VERIFY_TOKEN is not configured' });
      }

      console.log('🌐 Raw Facebook webhook body:', JSON.stringify(req.body, null, 2));

      // Facebook payload is nested - get first change
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value) {
        console.error('No value in Facebook webhook payload');
        return res.status(400).json({ error: 'Invalid Facebook payload' });
      }

      const fieldData = value.field_data || [];

      // Helper function to extract field values from Facebook field_data array
      const getField = (fieldName) => {
        const field = fieldData.find(f => f.name === fieldName);
        if (!field || !Array.isArray(field.values) || field.values.length === 0) return null;
        return field.values[0];
      };

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

      // Decide what to use as source_code (form_id or leadgen_id)
      const source_code = value.form_id || value.leadgen_id || null;

      if (!source_code || !name || !email) {
        console.warn('Missing required mapped fields from Facebook:', {
          source_code,
          name,
          email,
          about,
          phone,
          availableFields: fieldData.map(f => f.name)
        });

        return res.status(400).json({
          error: 'Missing required fields after mapping Facebook payload',
          details: {
            missing: {
              source_code: !source_code,
              name: !name,
              email: !email
            },
            availableFields: fieldData.map(f => f.name)
          }
        });
      }

      console.log('📥 Mapped Facebook lead:', {
        source_code,
        about,
        email,
        name,
        phone
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
        console.error('Error creating Facebook lead:', insertError);
        return res.status(500).json({
          error: 'Failed to create lead',
          details: insertError.message
        });
      }

      if (!newLead || newLead.length === 0) {
        console.error('No lead data returned from Facebook webhook insertion');
        return res.status(500).json({ error: 'Failed to create lead - no data returned' });
      }

      const createdLead = newLead[0];
      console.log('✅ Facebook lead created:', createdLead);

      return res.status(201).json({
        success: true,
        data: {
          lead_number: createdLead.lead_number,
          id: createdLead.id,
          name: createdLead.name,
          email: createdLead.email,
          source_id: createdLead.source_id,
          source_name: createdLead.source_name,
          created_at: new Date().toISOString()
        },
        message: 'Facebook lead created successfully'
      });
    } catch (error) {
      console.error('Facebook webhook error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = webhookController; 