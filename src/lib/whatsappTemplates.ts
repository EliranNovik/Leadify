import { supabase } from './supabase';
import { buildApiUrl } from './api';

export interface WhatsAppTemplate {
  id: number;
  title: string;
  name360: string;
  params: string;
  active: string;
  category_id: string;
  firm_id: number;
  number_id: number;
  content: string;
  language?: string; // Language code from WhatsApp API
}

// Interface for templates from WhatsApp API
export interface WhatsAppAPITemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  id: string;
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
    // TEMPORARILY: Always fetch directly from WhatsApp API instead of database
    console.log('🔍 TEMPORARILY: Fetching WhatsApp templates directly from API (skipping database)...');
    return await fetchTemplatesFromAPI();
  } catch (error) {
    console.error('❌ Error fetching WhatsApp templates:', error);
    // Fallback to database if API fails
    console.log('⚠️ API failed, falling back to database...');
    return await fetchTemplatesFromDatabase();
  }
}

// Function to fetch from database
async function fetchTemplatesFromDatabase(): Promise<WhatsAppTemplate[]> {
  try {
    console.log('🔍 Fetching WhatsApp templates from database...');
    
    const { data, error } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .order('title', { ascending: true });

    if (error) {
      console.error('❌ Error fetching from database:', error);
      return [];
    }

    console.log('✅ Templates fetched from database:', data?.length || 0);
    
    // Map database templates to our format, get language from API templates or use default
    const mappedTemplates = (data || []).map((template: any) => {
      // Get language from database field if exists, otherwise use 'en_US' as default
      const language = template.language || 'en_US';
      
      return {
        ...template,
        language: language,
        active: template.active || template.is_active ? 't' : 'f' // Handle both active and is_active fields
      };
    });
    
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
      .from('whatsapp_whatsapptemplate')
      .select('id, name360, title, language, content, params, active')
      .order('id', { ascending: true });
    
    // Create a map of database templates by name360+language for fast lookup
    const dbTemplateMap = new Map<string, any>();
    if (dbTemplates && !dbError) {
      dbTemplates.forEach((template: any) => {
        // Use name360+language as the key for matching
        const key = `${template.name360 || template.title || ''}_${template.language || ''}`.toLowerCase();
        dbTemplateMap.set(key, template);
      });
      console.log(`📋 Loaded ${dbTemplates.length} templates from database for ID mapping`);
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
        
        console.log(`📋 Template: ${template.name}, Variables found: ${variableCount}`, variableMatches);
        
        // Try to find matching database template by name360+language
        const lookupKey = `${template.name}_${template.language || ''}`.toLowerCase();
        const dbTemplate = dbTemplateMap.get(lookupKey);
        
        // Use database ID if found, otherwise use a negative index to indicate it's not in DB yet
        let templateId: number;
        if (dbTemplate && dbTemplate.id) {
          templateId = Number(dbTemplate.id);
          console.log(`✅ Matched API template "${template.name}" (${template.language}) to database ID: ${templateId}`);
        } else {
          // Template not found in database - use negative ID as placeholder
          // This will cause template_id to be NULL when saving (which is okay, foreign key allows NULL)
          templateId = -(index + 1);
          console.warn(`⚠️ API template "${template.name}" (${template.language}) not found in database, using placeholder ID: ${templateId}`);
        }
        
        return {
          id: templateId, // Use real database ID if found, otherwise negative placeholder
          title: template.name,
          name360: template.name,
          language: template.language,
          params: variableCount > 0 ? '1' : '0',
          active: template.status === 'APPROVED' ? 't' : 'f',
          category_id: template.category || '',
          firm_id: 0,
          number_id: 0,
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

// Function to trigger fetch and save to database
export async function refreshTemplatesFromAPI(): Promise<{success: boolean, message: string}> {
  try {
    console.log('🔄 Triggering template refresh from API...');
    
    const response = await fetch(buildApiUrl('/api/whatsapp/templates'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Error refreshing templates:', errorData);
      return { success: false, message: errorData.error || 'Failed to refresh templates' };
    }

    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Templates refreshed successfully');
      return { success: true, message: `Successfully fetched ${data.templates?.length || 0} templates` };
    }

    return { success: false, message: 'Failed to refresh templates' };
  } catch (error) {
    console.error('❌ Error refreshing templates:', error);
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
