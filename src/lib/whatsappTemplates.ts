import { supabase } from './supabase';
import { buildApiUrl } from './api';

export interface WhatsAppTemplate {
  id: number; // Database primary key (id column)
  title: string;
  name360: string;
  params: string;
  active: string;
  category_id: string;
  firm_id: number;
  number_id: number; // WhatsApp template ID (from API template.id, stored in number_id column)
  content: string;
  language?: string; // Language code from WhatsApp API
}

// Interface for templates from WhatsApp API
export interface WhatsAppAPITemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  id: string; // This is the WhatsApp template ID (stored in number_id in DB)
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{
      type: string;
      text?: string;
      url?: string;
    }>;
  }>;
}

export async function fetchWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
  try {
    // Fetch templates directly from database - simpler and more reliable
    console.log('🔍 Fetching WhatsApp templates from database...');
    return await fetchTemplatesFromDatabase();
  } catch (error) {
    console.error('❌ Error fetching WhatsApp templates:', error);
    return [];
  }
}

// Function to fetch from database
async function fetchTemplatesFromDatabase(): Promise<WhatsAppTemplate[]> {
  try {
    console.log('🔍 Fetching WhatsApp templates from database...');
    
    // Fetch only active templates from new table (whatsapp_templates_v2)
    const { data, error } = await supabase
      .from('whatsapp_templates_v2')
      .select('id, name, language, content, params, active, whatsapp_template_id')
      .eq('active', true) // Only fetch active templates
      .order('name', { ascending: true });

    if (error) {
      console.error('❌ Error fetching from database:', error);
      return [];
    }

    console.log('✅ Templates fetched from database:', data?.length || 0);
    
    // Map database templates to our format (new table structure only)
    const mappedTemplates: WhatsAppTemplate[] = (data || []).map((template: any) => {
      return {
        id: template.id, // Auto-incrementing database primary key (1, 2, 3, 4...)
        title: template.name || '',
        name360: template.name || '',
        params: template.params || '0',
        active: template.active === true ? 't' : 'f',
        category_id: '',
        firm_id: 0,
        number_id: template.whatsapp_template_id ? Number(template.whatsapp_template_id) : 0, // WhatsApp template ID
        content: template.content || '', // Template message content
        language: template.language || 'en_US',
      };
    });
    
    console.log('✅ Mapped templates with IDs:', mappedTemplates.map(t => ({ id: t.id, name360: t.name360, language: t.language })));
    return mappedTemplates || [];
  } catch (error) {
    console.error('❌ Error fetching from database:', error);
    return [];
  }
}

// Function to fetch from API
async function fetchTemplatesFromAPI(): Promise<WhatsAppTemplate[]> {
  try {
    console.log('🔍 Fetching WhatsApp templates from API...');
    
    // First, fetch templates from database to get real IDs for matching
    const { data: dbTemplates, error: dbError } = await supabase
      .from('whatsapp_templates_v2')
      .select('id, name, language, content, params, active, whatsapp_template_id')
      .order('id', { ascending: true });
    
    // Create a map of database templates by WhatsApp template ID for fast lookup
    const dbTemplateMapByWhatsAppId = new Map<string, any>();
    // Also create a fallback map by name+language
    const dbTemplateMapByNameLang = new Map<string, any>();
    
    if (dbTemplates && !dbError) {
      dbTemplates.forEach((template: any) => {
        // Primary matching: by WhatsApp template ID (whatsapp_template_id)
        if (template.whatsapp_template_id) {
          dbTemplateMapByWhatsAppId.set(String(template.whatsapp_template_id), template);
        }
        // Fallback matching: by name+language
        const key = `${template.name || ''}_${template.language || ''}`.toLowerCase();
        dbTemplateMapByNameLang.set(key, template);
      });
      console.log(`📋 Loaded ${dbTemplates.length} templates from database for ID mapping (${dbTemplateMapByWhatsAppId.size} with WhatsApp IDs)`);
    } else if (dbError) {
      console.warn('⚠️ Could not fetch templates from database for ID mapping:', dbError);
    }
    
    const response = await fetch(buildApiUrl('/api/whatsapp/templates'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Error fetching templates from API:', errorData);
      return [];
    }

    const data = await response.json();
    console.log('✅ Templates fetched from API:', data.templates?.length || 0, 'templates');

    if (data.success && data.templates) {
      // Map API templates to our format, matching with database IDs
      const mappedTemplates = data.templates.map((template: WhatsAppAPITemplate, index: number) => {
        // Find the BODY component and count variables
        const bodyComponent = template.components?.find(c => c.type === 'BODY');
        const textContent = bodyComponent?.text || '';
        
        // Count ALL variables ({{1}}, {{2}}, {{3}}, etc.)
        const variableMatches = textContent.match(/\{\{\d+\}\}/g);
        const variableCount = variableMatches ? variableMatches.length : 0;
        // Store actual count instead of just 0 or 1
        const paramsCount = String(variableCount);
        
        console.log(`📋 Template: ${template.name}, Variables found: ${variableCount}`, variableMatches);
        
        // PRIMARY MATCH: Match by WhatsApp template ID (template.id from API = number_id in DB)
        let dbTemplate = template.id ? dbTemplateMapByWhatsAppId.get(String(template.id)) : null;
        
        // FALLBACK MATCH: If not found by WhatsApp ID, try name+language
        if (!dbTemplate) {
          const lookupKey = `${template.name}_${template.language || ''}`.toLowerCase();
          dbTemplate = dbTemplateMapByNameLang.get(lookupKey);
        }
        
        // Use database ID if found, otherwise use a negative index to indicate it's not in DB yet
        let templateId: number;
        if (dbTemplate && dbTemplate.id) {
          templateId = Number(dbTemplate.id);
          console.log(`✅ Matched API template "${template.name}" (${template.language}, WhatsApp ID: ${template.id}) to database ID: ${templateId}`);
        } else {
          // Template not found in database - use negative ID as placeholder
          // This will cause template_id to be NULL when saving (which is okay, foreign key allows NULL)
          templateId = -(index + 1);
          console.warn(`⚠️ API template "${template.name}" (${template.language}, WhatsApp ID: ${template.id}) not found in database, using placeholder ID: ${templateId}`);
        }
        
        return {
          id: templateId, // Use real database ID if found, otherwise negative placeholder
          title: template.name,
          name360: template.name,
          language: template.language,
          params: paramsCount, // Store actual count: '0', '1', '2', '3', etc.
          active: template.status === 'APPROVED' ? 't' : 'f',
          category_id: template.category || '',
          firm_id: 0,
          number_id: template.id ? Number(template.id) : 0, // Store WhatsApp template ID
          content: textContent,
        };
      });

      console.log('📋 Mapped templates:', mappedTemplates.length);
      return mappedTemplates;
    }

    return [];
  } catch (error) {
    console.error('❌ Error fetching templates from API:', error);
    return [];
  }
}

// Function to trigger sync templates from API to database
export async function refreshTemplatesFromAPI(): Promise<{success: boolean, message: string}> {
  try {
    console.log('🔄 Triggering template sync from API to database...');
    
    // Use the sync endpoint instead of just fetching
    const response = await fetch(buildApiUrl('/api/whatsapp/templates/sync'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Error syncing templates:', errorData);
      return { success: false, message: errorData.error || 'Failed to sync templates' };
    }

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Templates synced successfully');
      return { success: true, message: data.message || `Successfully synced ${data.new || 0} new, ${data.updated || 0} updated templates` };
    }

    return { success: false, message: data.error || 'Failed to sync templates' };
  } catch (error) {
    console.error('❌ Error syncing templates:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function filterTemplates(templates: WhatsAppTemplate[], searchTerm: string): WhatsAppTemplate[] {
  if (!searchTerm.trim()) return templates;
  
  const lowerSearchTerm = searchTerm.toLowerCase();
  return templates.filter(template => 
    template.title?.toLowerCase().includes(lowerSearchTerm)
  );
}

// Test function to check database access
export async function testDatabaseAccess(): Promise<void> {
  try {
    console.log('🧪 Testing database access...');
    
    // First, let's check if we can access the table at all
    const { data: allData, error: allError } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .limit(5);
    
    console.log('🔍 All data test:', { data: allData, error: allError });
    
    // Check the structure of the first record
    if (allData && allData.length > 0) {
      console.log('📋 First record structure:', Object.keys(allData[0]));
      console.log('📋 First record data:', allData[0]);
    } else {
      console.log('⚠️ No data found in table');
    }
    
    // Let's check what values are in the 'active' column
    const { data: activeValues, error: activeValuesError } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('active')
      .limit(10);
    
    console.log('🔍 Active column values:', { data: activeValues, error: activeValuesError });
    
    // Check for any templates regardless of active status
    const { data: anyTemplates, error: anyTemplatesError } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .limit(3);
    
    console.log('🔍 Any templates (regardless of active status):', { data: anyTemplates, error: anyTemplatesError });
    
    // Check active templates specifically
    const { data: activeData, error: activeError } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .eq('active', 't')
      .limit(5);
    
    console.log('✅ Active templates test:', { data: activeData, error: activeError });
    
    // Also try with 'true' instead of 't'
    const { data: activeTrueData, error: activeTrueError } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .eq('active', 'true')
      .limit(5);
    
    console.log('✅ Active templates (true) test:', { data: activeTrueData, error: activeTrueError });
    
  } catch (error) {
    console.error('❌ Database access test failed:', error);
  }
}
