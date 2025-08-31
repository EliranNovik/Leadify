const supabase = require('../config/supabase');

const webhookController = {
  /**
   * Catch form data and create a new lead
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async catchFormData(req, res) {
    try {
      // Log the received form data
      const formData = {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        topic: req.body.topic,
        facts: req.body.facts,
        source: req.body.source || 'webhook'
      };

      // Validate required fields
      if (!formData.name || !formData.email || !formData.phone) {
        return res.status(400).json({ 
          error: 'Missing required fields: name, email, phone' 
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

      // Prepare lead data
      const leadData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        topic: formData.topic,
        facts: formData.facts,
        source: formData.source,
        stage: 'created',
        created_at: new Date().toISOString()
      };

      // Insert new lead
      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert([leadData])
        .select()
        .single();

      if (insertError) {
        console.error('Error creating lead:', insertError);
        return res.status(500).json({ error: 'Failed to create lead' });
      }

      res.status(201).json({ 
        success: true, 
        lead_id: newLead.id,
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
  }
};

module.exports = webhookController; 