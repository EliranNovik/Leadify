const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// WhatsApp API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID = process.env.WHATSAPP_WABA_ID || '1290806625806976';

/**
 * Sync WhatsApp templates from Meta API to database
 * This service automatically fetches templates and updates the whatsapp_templates table
 */
class WhatsAppTemplateSyncService {
  
  /**
   * Fetch all templates from WhatsApp API
   */
  async fetchTemplatesFromAPI() {
    try {
      console.log('🔄 Fetching templates from WhatsApp API...');
      
      const response = await axios.get(
        `${WHATSAPP_API_URL}/${WABA_ID}/message_templates`,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          params: {
            limit: 1000 // Get up to 1000 templates
          }
        }
      );

      const templates = response.data.data || [];
      console.log(`✅ Fetched ${templates.length} templates from WhatsApp API`);
      
      return templates;
    } catch (error) {
      console.error('❌ Error fetching templates from WhatsApp API:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Process and save templates to database
   */
  async syncTemplatesToDatabase() {
    try {
      console.log('🔄 Starting template sync...');
      
      // Fetch templates from API
      const apiTemplates = await this.fetchTemplatesFromAPI();
      
      if (apiTemplates.length === 0) {
        console.log('⚠️ No templates found in WhatsApp API');
        return { success: true, new: 0, updated: 0, skipped: 0 };
      }

      let newCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors = [];

      // Process each template
      for (const apiTemplate of apiTemplates) {
        try {
          // Extract template data
          const bodyComponent = apiTemplate.components?.find(comp => comp.type === 'BODY');
          const textContent = bodyComponent?.text || '';
          
          // Count variables ({{1}}, {{2}}, etc.)
          const variableMatches = textContent.match(/\{\{\d+\}\}/g);
          const variableCount = variableMatches ? variableMatches.length : 0;
          // Store actual count instead of just 0 or 1
          const paramsCount = String(variableCount);
          
          // Prepare template data for database
          const templateData = {
            whatsapp_template_id: String(apiTemplate.id), // WhatsApp template ID (unique)
            name: apiTemplate.name || 'unknown',
            language: apiTemplate.language || 'en_US',
            content: textContent, // The actual template message text
            params: paramsCount, // Store actual count: '0', '1', '2', '3', etc.
            active: apiTemplate.status === 'APPROVED',
            updated_at: new Date().toISOString()
          };

          // Check if template already exists by whatsapp_template_id
          const { data: existingTemplate, error: checkError } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, whatsapp_template_id, name, language')
            .eq('whatsapp_template_id', templateData.whatsapp_template_id)
            .maybeSingle();

          if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned (ok)
            console.error(`❌ Error checking template ${templateData.whatsapp_template_id}:`, checkError);
            errors.push({ template: apiTemplate.name, error: checkError.message });
            skippedCount++;
            continue;
          }

          if (existingTemplate) {
            // Update existing template
            const { error: updateError } = await supabase
              .from('whatsapp_templates_v2')
              .update({
                name: templateData.name,
                language: templateData.language,
                content: templateData.content,
                params: templateData.params,
                active: templateData.active,
                updated_at: templateData.updated_at
              })
              .eq('whatsapp_template_id', templateData.whatsapp_template_id);

            if (updateError) {
              console.error(`❌ Error updating template ${templateData.whatsapp_template_id}:`, updateError);
              errors.push({ template: apiTemplate.name, error: updateError.message });
              skippedCount++;
            } else {
              updatedCount++;
              console.log(`✅ Updated template: ${templateData.name} (${templateData.language}) - ID: ${existingTemplate.id}`);
            }
          } else {
            // Insert new template (id will auto-increment)
            const { data: newTemplate, error: insertError } = await supabase
              .from('whatsapp_templates_v2')
              .insert({
                whatsapp_template_id: templateData.whatsapp_template_id,
                name: templateData.name,
                language: templateData.language,
                content: templateData.content,
                params: templateData.params,
                active: templateData.active
              })
              .select('id')
              .single();

            if (insertError) {
              console.error(`❌ Error inserting template ${templateData.whatsapp_template_id}:`, insertError);
              errors.push({ template: apiTemplate.name, error: insertError.message });
              skippedCount++;
            } else {
              newCount++;
              console.log(`✅ Inserted new template: ${templateData.name} (${templateData.language}) - DB ID: ${newTemplate.id}, WhatsApp ID: ${templateData.whatsapp_template_id}`);
            }
          }
        } catch (templateError) {
          console.error(`❌ Error processing template ${apiTemplate.name}:`, templateError);
          errors.push({ template: apiTemplate.name, error: templateError.message });
          skippedCount++;
        }
      }

      console.log(`✅ Sync complete: ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);
      
      return {
        success: true,
        new: newCount,
        updated: updatedCount,
        skipped: skippedCount,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('❌ Error syncing templates:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get template by database ID
   */
  async getTemplateByDatabaseId(databaseId) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_templates_v2')
        .select('*')
        .eq('id', databaseId)
        .eq('active', true)
        .single();

      if (error) {
        console.error('❌ Error fetching template:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error getting template:', error);
      return null;
    }
  }

  /**
   * Get template by WhatsApp template ID
   */
  async getTemplateByWhatsAppId(whatsappTemplateId) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_templates_v2')
        .select('*')
        .eq('whatsapp_template_id', String(whatsappTemplateId))
        .eq('active', true)
        .single();

      if (error) {
        console.error('❌ Error fetching template:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('❌ Error getting template:', error);
      return null;
    }
  }
}

module.exports = new WhatsAppTemplateSyncService();

