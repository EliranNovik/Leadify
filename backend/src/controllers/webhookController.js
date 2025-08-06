const supabase = require('../config/supabase');

const webhookController = {
  /**
   * Catch form data and create a new lead
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async catchFormData(req, res) {
    try {
      console.log('Webhook received form data:', {
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.url
      });
      
      // Debug: Log the facts field specifically
      console.log('Facts field received:', req.body.facts);
      console.log('Facts type:', typeof req.body.facts);

      // Extract form data from request body
      const formData = req.body;
      
      // Validate required fields
      if (!formData.name || !formData.email) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name and email are required'
        });
      }

      // Generate lead number (format: L + current year + sequential number)
      const currentYear = new Date().getFullYear();
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('lead_number')
        .order('lead_number', { ascending: false })
        .limit(1);

      let leadNumber;
      if (existingLeads && existingLeads.length > 0) {
        const lastLeadNumber = existingLeads[0].lead_number;
        // Extract the numeric part from the last lead number
        const numericPart = lastLeadNumber.replace(/^L/, '');
        const nextNumber = parseInt(numericPart) + 1;
        leadNumber = `L${nextNumber}`;
      } else {
        leadNumber = `L1`;
      }

      // Prepare lead data - only include fields that exist in the database
      const leadData = {
        lead_number: leadNumber,
        name: formData.name,
        email: formData.email,
        phone: formData.phone || null,
        mobile: formData.mobile || null,
        topic: formData.topic || formData.category || 'Inquiry',
        stage: 'created',
        status: 'new',
        source: formData.source || 'Web Form',
        language: formData.language || 'English',
        created_at: new Date().toISOString(),
        // Store additional fields as JSON in facts column
        facts: formData.facts || null
      };
      
      // Debug: Log the lead data being inserted
      console.log('Lead data to be inserted:', leadData);
      console.log('Facts field in lead data:', leadData.facts);

      // Insert new lead into database
      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert([leadData])
        .select()
        .single();

      if (insertError) {
        console.error('❌ Error creating lead:', insertError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create lead',
          details: insertError.message
        });
      }

      console.log('✅ Lead created successfully:', {
        lead_number: newLead.lead_number,
        name: newLead.name,
        email: newLead.email
      });

      // Return success response
      res.status(201).json({
        success: true,
        message: 'Lead created successfully',
        data: {
          lead_number: newLead.lead_number,
          id: newLead.id,
          name: newLead.name,
          email: newLead.email,
          created_at: newLead.created_at
        }
      });

    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
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