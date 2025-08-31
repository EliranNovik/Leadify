import { supabase } from './supabase';

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
}

export async function fetchWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
  try {
    console.log('🔍 Fetching WhatsApp templates from database...');
    
    // First try to get all templates without filtering by active status
    const { data, error } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .order('title', { ascending: true });

    console.log('📊 Database response (all templates):', { data, error });

    if (error) {
      console.error('❌ Error fetching WhatsApp templates:', error);
      throw error;
    }

    console.log('✅ Templates fetched successfully:', data?.length || 0, 'templates');
    if (data && data.length > 0) {
      console.log('📋 First few templates:', data.slice(0, 3));
      
      // Check what the active field looks like
      const activeValues = [...new Set(data.map(t => t.active))];
      console.log('🔍 Active field values found:', activeValues);
    }

    // Filter active templates if we have data
    const activeTemplates = data?.filter(template => 
      template.active === 't' || template.active === 'true' || template.active === true
    ) || [];

    console.log('✅ Active templates filtered:', activeTemplates.length, 'templates');

    return activeTemplates;
  } catch (error) {
    console.error('❌ Error fetching WhatsApp templates:', error);
    return [];
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
