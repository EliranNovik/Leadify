// Script to add the second_test template to the database
import { createClient } from '@supabase/supabase-js';

// You'll need to replace these with your actual Supabase credentials
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'your-supabase-url';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-supabase-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function addSecondTestTemplate() {
  try {
    console.log('🔄 Adding second_test template to database...');

    const { data, error } = await supabase
      .from('whatsapp_templates')
      .insert([
        {
          title: 'Second Test',
          name360: 'second_test',
          category: 'Marketing',
          params: '0', // No parameters required
          content: 'Eliran made the second test!',
          is_active: true
        }
      ])
      .select();

    if (error) {
      console.error('❌ Error adding template:', error);
      return;
    }

    console.log('✅ Template added successfully:', data);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

addSecondTestTemplate();
